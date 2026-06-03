import { pool } from "../config/db.js";

export const fetchAdminReport = async (fromDate, toDate, groupBy = "month") => {
  const usersQuery = `
    SELECT 
      COUNT(*) AS total_users,
      COUNT(*) FILTER (WHERE status = 'Approve') AS approved_users,
      COUNT(*) FILTER (WHERE status = 'On Hold') AS hold_users,
      COUNT(*) FILTER (WHERE status::text = 'In Process') AS in_process_users,
      COUNT(*) FILTER (WHERE status = 'Deactivate') AS deactivated_users
    FROM users
    WHERE created_at BETWEEN $1 AND $2
  `;

  const messagesQuery = `
    SELECT COUNT(*) AS total_messages
    FROM messages
    WHERE created_at BETWEEN $1 AND $2
  `;

  // ✅ subscriptions -> user_plans
  const subscriptionsQuery = `
    SELECT COUNT(*) AS total_subscriptions
    FROM user_plans
    WHERE created_at BETWEEN $1 AND $2
  `;

  const usersTimelineQuery = `
    SELECT 
      DATE_TRUNC($3, created_at)::date AS period,
      COUNT(*) AS total_users
    FROM users
    WHERE created_at BETWEEN $1 AND $2
    GROUP BY period
    ORDER BY period
  `;

  const messagesTimelineQuery = `
    SELECT 
      DATE_TRUNC($3, created_at)::date AS period,
      COUNT(*) AS total_messages
    FROM messages
    WHERE created_at BETWEEN $1 AND $2
    GROUP BY period
    ORDER BY period
  `;

  // ✅ plan_name plans table se aayega
  const plansTimelineQuery = `
    SELECT
      DATE_TRUNC($3, up.created_at)::date AS period,
      pl.name AS plan_name,
      COUNT(*) AS count
    FROM user_plans up
    JOIN plans pl ON pl.id = up.plan_id
    WHERE up.created_at BETWEEN $1 AND $2
    GROUP BY period, pl.name
    ORDER BY period
  `;

  /**
   * ✅ IMPORTANT:
   * Frontend expects fields:
   * - plan_name, plan_status, plan_purchase_date
   * - amount, currency, payment_status, payment_date
   *
   * user_plans me plan_name nahi hai -> plans join
   * payment join: safest is using payment_id (since user_plans has it)
   */
  const paymentsQuery = `
    SELECT
      u.id AS user_id,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), ''),
        'N/A'
      ) AS user_name,
      u.email,

      pl.name AS plan_name,
      up.status AS plan_status,
      COALESCE(up.starts_at, up.created_at) AS plan_purchase_date,

      pay.amount,
      pay.currency,
      pay.status AS payment_status,
      pay.created_at AS payment_date

    FROM user_plans up
    JOIN users u ON u.id = up.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
    JOIN plans pl ON pl.id = up.plan_id
    LEFT JOIN payments pay ON pay.id = up.payment_id

    WHERE up.created_at BETWEEN $1 AND $2
    ORDER BY up.created_at DESC
  `;

  const messagesDetailsQuery = `
    SELECT
      m.id,
      m.created_at,
      m.sender_id,
      m.receiver_id,
      m.content,
      m.attachment_url,
      m.is_read,

      COALESCE(ps.first_name, 'N/A') AS sender_name,
      us.email AS sender_email,

      COALESCE(pr.first_name, 'N/A') AS receiver_name,
      ur.email AS receiver_email

    FROM messages m
    LEFT JOIN users us ON us.id = m.sender_id
    LEFT JOIN profiles ps ON ps.user_id = us.id
    LEFT JOIN users ur ON ur.id = m.receiver_id
    LEFT JOIN profiles pr ON pr.user_id = ur.id
    WHERE m.created_at BETWEEN $1 AND $2
    ORDER BY m.created_at DESC
    LIMIT 500
  `;

  const [
    users,
    messages,
    subscriptions,
    usersTimeline,
    messagesTimeline,
    plansTimeline,
    payments,
    messagesDetails,
  ] = await Promise.all([
    pool.query(usersQuery, [fromDate, toDate]),
    pool.query(messagesQuery, [fromDate, toDate]),
    pool.query(subscriptionsQuery, [fromDate, toDate]),
    pool.query(usersTimelineQuery, [fromDate, toDate, groupBy]),
    pool.query(messagesTimelineQuery, [fromDate, toDate, groupBy]),
    pool.query(plansTimelineQuery, [fromDate, toDate, groupBy]),
    pool.query(paymentsQuery, [fromDate, toDate]),
    pool.query(messagesDetailsQuery, [fromDate, toDate]),
  ]);

  return {
    summary: {
      users: users.rows[0],
      messages: messages.rows[0],
      subscriptions: subscriptions.rows[0],
    },
    timeline: {
      users: usersTimeline.rows,
      messages: messagesTimeline.rows,
      plans: plansTimeline.rows,
    },
    users_activity: payments.rows,
    messages_activity: messagesDetails.rows,
  };
};
