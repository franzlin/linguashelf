// First-run bootstrap: seed the initial admin account from the environment.
//
// Separate from users.js so the auth module stays free of startup concerns and
// does not need to know about user settings.
import { nanoid } from 'nanoid'
import { readDb, writeDb } from './storage.js'
import { hashPassword } from './users.js'
import { userSettings } from './settings.js'

export async function ensureInitialAdmin() {
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '')
  if (!email || !password) return

  const db = await readDb()
  if (db.users.some((user) => user.email === email)) return
  db.users.push({
    id: nanoid(),
    email,
    name: email.split('@')[0] || 'Admin',
    passwordHash: await hashPassword(password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  })
  userSettings(db, db.users[db.users.length - 1].id)
  await writeDb(db)
}
