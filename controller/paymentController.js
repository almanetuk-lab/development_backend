import Stripe from "stripe";
import { pool } from "../config/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ======================================================
   0) SHARED FULFILLMENT LOGIC (USED BY WEBHOOK & VERIFY)
====================================================== */
export const fulfillPayment = async (session) => {
  const user_id = Number(session.metadata?.user_id);
  const plan_id = Number(session.metadata?.plan_id);
  const amount = (session.amount_total || 0) / 100;
  const currency = (session.currency || "gbp").toUpperCase();

  if (!user_id || !plan_id) {
    throw new Error("Missing metadata user_id or plan_id in Stripe session");
  }

  /* 1️⃣ Mark payment SUCCESS */
  const paymentRes = await pool.query(
    `
    UPDATE payments
    SET status='success', amount=$1, currency=$2
    WHERE stripe_session_id=$3
    RETURNING id
    `,
    [amount, currency, session.id]
  );

  let payment_id;
  if (paymentRes.rows.length === 0) {
    const planRes = await pool.query(`SELECT name, price FROM plans WHERE id=$1`, [plan_id]);
    const planName = planRes.rows[0]?.name || "Subscription Plan";
    const planPrice = planRes.rows[0]?.price || amount;

    const newPayment = await pool.query(
      `
      INSERT INTO payments (user_id, plan_id, plan_name, amount, currency, stripe_session_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'success')
      RETURNING id
      `,
      [user_id, plan_id, planName, planPrice, currency, session.id]
    );
    payment_id = newPayment.rows[0].id;
  } else {
    payment_id = paymentRes.rows[0].id;
  }

  /* Check if already active in user_plans */
  const existingPlan = await pool.query(
    `SELECT id FROM user_plans WHERE payment_id=$1 AND status='active'`,
    [payment_id]
  );
  if (existingPlan.rows.length > 0) {
    return { status: "already_fulfilled" };
  }

  /* 2️⃣ Get plan duration */
  const planRes = await pool.query(
    `SELECT duration FROM plans WHERE id=$1`,
    [plan_id]
  );

  if (planRes.rows.length === 0) {
    throw new Error("Plan not found");
  }

  const duration = Number(planRes.rows[0].duration);

  /* 3️⃣ Expire old active plans */
  await pool.query(
    `
    UPDATE user_plans
    SET status='expired'
    WHERE user_id=$1 AND status='active'
    `,
    [user_id]
  );

  /* 4️⃣ Insert new active plan */
  const insertResult = await pool.query(
    `
    INSERT INTO user_plans
    (
      user_id,
      plan_id,
      payment_id,
      status,
      starts_at,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      'active',
      NOW(),
      NOW() + ($4 * INTERVAL '1 day')
    )
    RETURNING *
    `,
    [user_id, plan_id, payment_id, duration]
  );

  console.log("✅ user_plans inserted:", insertResult.rows);
  return { status: "success", plan: insertResult.rows[0] };
};

/* ======================================================
   1) CREATE CHECKOUT SESSION
====================================================== */
export const createCheckoutSession = async (req, res) => {
  try {
    const { plan, user_id } = req.body;

    if (!plan || !user_id) {
      return res.status(400).json({ message: "Missing plan or user_id" });
    }

    // ✅ SECURITY: Enforce ownership — the authenticated user can only create
    // a checkout session for their own account. Prevents privilege escalation.
    if (String(req.user?.id) !== String(user_id)) {
      return res.status(403).json({ message: "Forbidden: user_id mismatch." });
    }

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

    // Direct activation for Free Tiers (Price = 0)
    if (Number(plan.price) === 0) {
      const dummySessionId = `free_sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 1. Insert completed free payment
      const newPayment = await pool.query(
        `
        INSERT INTO payments (user_id, plan_id, plan_name, amount, currency, stripe_session_id, status)
        VALUES ($1, $2, $3, 0, 'GBP', $4, 'success')
        RETURNING id
        `,
        [user_id, plan.id, plan.name, dummySessionId]
      );
      const payment_id = newPayment.rows[0].id;
      const duration = Number(plan.duration) || 30;

      // 2. Expire old active plans
      await pool.query(
        `
        UPDATE user_plans
        SET status='expired'
        WHERE user_id=$1 AND status='active'
        `,
        [user_id]
      );

      // 3. Activate new free plan
      await pool.query(
        `
        INSERT INTO user_plans (user_id, plan_id, payment_id, status, starts_at, expires_at)
        VALUES ($1, $2, $3, 'active', NOW(), NOW() + ($4 * INTERVAL '1 day'))
        `,
        [user_id, plan.id, payment_id, duration]
      );

      const successUrl = `${frontendUrl}/#/payment-success?session_id=${dummySessionId}`;
      return res.json({ url: successUrl });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: plan.name },
            unit_amount: Math.round(Number(plan.price) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${frontendUrl}/#/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/#/payment-failed`,
      metadata: {
        user_id: String(user_id),
        plan_id: String(plan.id),
      },
    });

    // ✅ Save pending payment
    await pool.query(
      `
      INSERT INTO payments
      (user_id, plan_id, plan_name, amount, currency, stripe_session_id, status)
      VALUES ($1, $2, $3, $4, 'GBP', $5, 'pending')
      `,
      [user_id, plan.id, plan.name, plan.price, session.id]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe session error:", err);
    res.status(500).json({ message: "Stripe error" });
  }
};

/* ======================================================
   2) VERIFY CHECKOUT SESSION (FRONTEND SUCCESS REDIRECT)
====================================================== */
export const verifyCheckoutSession = async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ message: "Missing session_id" });
    }

    if (String(session_id).startsWith("free_sess_")) {
      return res.json({ success: true, message: "Free tier plan verified & active!" });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid" || session.status === "complete") {
      const fulfillment = await fulfillPayment(session);
      return res.json({ success: true, message: "Payment verified & plan activated!", fulfillment });
    } else {
      return res.status(400).json({ success: false, message: "Payment status is not paid" });
    }
  } catch (err) {
    console.error("❌ Verify session error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to verify session" });
  }
};

/* ======================================================
   3) STRIPE WEBHOOK (PAYMENT → USER PLAN)
====================================================== */
export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.status(400).send("Webhook Error");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      await fulfillPayment(session);
    } catch (err) {
      console.error("❌ Webhook DB error:", err);
    }
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object;
    await pool.query(
      `UPDATE payments SET status='failed' WHERE stripe_session_id=$1`,
      [session.id]
    );
  }

  res.json({ received: true });
};

/* ======================================================
   4) PAYMENT HISTORY
====================================================== */
export const getUserPayments = async (req, res) => {
  const { user_id } = req.params;
  const authenticatedUserId = req.user?.id;

  if (!authenticatedUserId) {
    return res.status(401).json({ message: "Unauthorized: no valid session." });
  }

  // ✅ SECURITY: Prevent Insecure Direct Object Reference (IDOR) attacks by ensuring
  // that the authenticated user can only view their own payment history.
  if (String(authenticatedUserId) !== String(user_id)) {
    return res.status(403).json({ message: "Forbidden: You cannot access another user's payment history." });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, plan_name, amount, currency, status, created_at
      FROM payments
      WHERE user_id=$1
      ORDER BY created_at DESC
      `,
      [authenticatedUserId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Fetch payment history error:", err);
    res.status(500).json({ message: "Database error" });
  }
};
