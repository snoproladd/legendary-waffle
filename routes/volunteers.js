
// routes/volunteers.js
import express from 'express';
import * as db from '../lib/dbSync.js';

const router = express.Router();

/**
 * Quick existence check used by the frontend to pre-block duplicate emails.
 * GET /api/volunteers/exists?email=...
 * Returns: { exists: true|false }
 */
router.get('/volunteers/exists', async (req, res, next) => {
  try {
    const email = String(req.query?.email ?? '').trim();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    // Optional domain block: keep consistent with your frontend
    if (email.toLowerCase().endsWith('@jwpub.org')) {
      return res.status(200).json({ exists: false }); // we block later anyway
    }

    const exists = await db.emailExists(email);
    return res.json({ exists });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/volunteers
 * Body: { email, password }
 * Returns 201 inserted row or 409 if already exists.
 */
router.post('/volunteers', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const row = await db.insertEmailPass(email, password);

    if (!row) {
      // IF NOT EXISTS prevented insert => already present
      return res.status(409).json({ error: 'Email already registered.' });
    }

    return res.status(201).json(row);
  } catch (err) {
    if (err?.number === 2627 || err?.number === 2601) {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    next(err);
  }
});

export default router;

