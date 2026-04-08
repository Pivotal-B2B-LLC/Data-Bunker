const {pool} = require("./src/db/connection");
(async () => {
  const r = await pool.query(
    "SELECT contact_id, first_name, last_name, job_title, linkedin_url, data_source FROM contacts WHERE linkedin_url IS NOT NULL AND linkedin_url != '' ORDER BY contact_id DESC LIMIT 20"
  );
  console.log("=== LinkedIn Contacts in DB ===");
  r.rows.forEach(row => {
    console.log(
      row.contact_id + " | " +
      row.first_name + " " + row.last_name + " | " +
      (row.job_title || "-") + " | " +
      (row.linkedin_url || "").slice(0, 60) + " | " +
      (row.data_source || "?")
    );
  });
  console.log("\nTotal with linkedin_url:", r.rows.length);

  // Check total contacts
  const total = await pool.query("SELECT COUNT(*) as cnt FROM contacts");
  console.log("Total contacts:", total.rows[0].cnt);

  // Check today's
  const today = await pool.query("SELECT COUNT(*) as cnt FROM contacts WHERE created_at >= NOW() - INTERVAL '24 hours'");
  console.log("Created last 24h:", today.rows[0].cnt);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
