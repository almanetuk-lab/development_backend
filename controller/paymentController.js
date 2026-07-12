import Stripe from "stripe";
import { pool } from "../config/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ======================================================
   1) CREATE CHECKOUT SESSION
====================================================== */
export const createCheckoutSession = async (req, res) => {
  try {
    const { plan, user_id } = req.body;

    if (!plan || !user_id) {
      return res.status(400).json({ message: "Missing plan or user_id" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: plan.name },
            unit_amount: plan.price * 100,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/#/payment-success`,
      cancel_url: `${process.env.FRONTEND_URL}/#/payment-failed`,
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
   2) STRIPE WEBHOOK  (PAYMENT → USER PLAN)
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

    const user_id = Number(session.metadata.user_id);
    const plan_id = Number(session.metadata.plan_id);
    const amount = session.amount_total / 100;
    const currency = session.currency.toUpperCase();

    try {
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

      if (paymentRes.rows.length === 0) {
        console.error("❌ Payment row not found");
        return res.json({ received: true });
      }

      const payment_id = paymentRes.rows[0].id;

      /* 2️⃣ Get plan duration (NUMBER of days) */
      const planRes = await pool.query(
        `SELECT duration FROM plans WHERE id=$1`,
        [plan_id]
      );

      if (planRes.rows.length === 0) {
        throw new Error("❌ Plan not found");
      }

      const duration = Number(planRes.rows[0].duration); // 🔥 IMPORTANT

      /* 3️⃣ Expire old active plans */
      await pool.query(
        `
        UPDATE user_plans
        SET status='expired'
        WHERE user_id=$1 AND status='active'
        `,
        [user_id]
      );

      /* 4️⃣ Insert new active plan (✅ FIXED INTERVAL) */
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
   3) PAYMENT HISTORY
====================================================== */
export const getUserPayments = async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT id, plan_name, amount, currency, status, created_at
      FROM payments
      WHERE user_id=$1
      ORDER BY created_at DESC
      `,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Fetch payment history error:", err);
    res.status(500).json({ message: "Database error" });
  }
};
