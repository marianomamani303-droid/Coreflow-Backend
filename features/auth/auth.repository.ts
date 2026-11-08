import { pool } from '../../config/database'

import type { ResultSetHeader } from 'mysql2'

import type { RowDataPacket } from 'mysql2'

export interface UserRow extends RowDataPacket {
  id: string
  full_name: string
  email: string
  password_hash: string
  status: 'active' | 'disabled'
}

export async function verifyExistUser(email: string): Promise<UserRow[]> {
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT id, full_name, email, password_hash, status FROM users WHERE email = ? LIMIT 1',
    [email],
  )

  return rows
}

export async function createUser(
  fullName: string,
  email: string,
  passwordHash: string,
): Promise<string> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO users (full_name, email, password_hash)
     VALUES (?, ?, ?)`,
    [fullName, email, passwordHash],
  )

  return String(result.insertId)
}

export type UserIdentityRow = Pick<UserRow, 'id' | 'full_name' | 'email' | 'status'> &
  RowDataPacket

export async function findUserById(userId: string): Promise<UserIdentityRow | undefined> {
  const [rows] = await pool.execute<UserIdentityRow[]>(
    'SELECT id, full_name, email, status FROM users WHERE id = ? LIMIT 1',
    [userId],
  )
  return rows[0]
}
