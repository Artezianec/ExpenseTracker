import { randomUUID } from 'node:crypto';

export async function getHouseholdId(pool, userId) {
  const [rows] = await pool.query(
    'SELECT household_id FROM users WHERE id = ?',
    [userId],
  );
  return rows[0]?.household_id ?? null;
}

export async function getHouseholdUserIds(pool, userId) {
  const householdId = await getHouseholdId(pool, userId);
  if (!householdId) return [userId];
  const [rows] = await pool.query(
    'SELECT user_id FROM household_members WHERE household_id = ?',
    [householdId],
  );
  const ids = rows.map((r) => r.user_id);
  return ids.length ? ids : [userId];
}

export async function createHouseholdForUser(pool, userId) {
  const householdId = randomUUID();
  const now = new Date();
  await pool.query(
    'INSERT INTO households (id, created_by, created_at) VALUES (?, ?, ?)',
    [householdId, userId, now],
  );
  await pool.query('UPDATE users SET household_id = ? WHERE id = ?', [
    householdId,
    userId,
  ]);
  await pool.query(
    `INSERT INTO household_members (household_id, user_id, role, joined_at)
     VALUES (?, ?, 'admin', ?)`,
    [householdId, userId, now],
  );
  return householdId;
}

export async function ensureHouseholdForUser(pool, userId) {
  const existing = await getHouseholdId(pool, userId);
  if (existing) return existing;
  return createHouseholdForUser(pool, userId);
}

export async function addUserToGroup(pool, groupId, userRow, joinedAt = new Date()) {
  const [memberExists] = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userRow.id],
  );
  if (!memberExists.length) {
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`,
      [groupId, userRow.id, joinedAt],
    );
  }

  const [participantExists] = await pool.query(
    'SELECT id FROM participants WHERE group_id = ? AND user_id = ?',
    [groupId, userRow.id],
  );
  if (!participantExists.length) {
    const name = userRow.display_name ?? userRow.email;
    await pool.query(
      `INSERT INTO participants (id, group_id, name, user_id, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), groupId, name, userRow.id, joinedAt],
    );
  }
}

export async function addAllHouseholdMembersToGroup(
  pool,
  groupId,
  householdId,
  joinedAt = new Date(),
) {
  const [members] = await pool.query(
    `SELECT u.* FROM household_members hm
     INNER JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = ?`,
    [householdId],
  );
  for (const userRow of members) {
    await addUserToGroup(pool, groupId, userRow, joinedAt);
  }
}

export async function syncUserToAllHouseholdGroups(pool, householdId, userRow) {
  const now = new Date();
  const [groups] = await pool.query(
    `SELECT DISTINCT gm.group_id AS id
     FROM group_members gm
     INNER JOIN users u ON u.id = gm.user_id
     WHERE u.household_id = ?`,
    [householdId],
  );
  for (const group of groups) {
    await addUserToGroup(pool, group.id, userRow, now);
  }
}

export async function syncHouseholdParticipantsForGroup(
  pool,
  groupId,
  householdId,
) {
  if (!householdId) return;
  const [members] = await pool.query(
    `SELECT u.* FROM household_members hm
     INNER JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = ?`,
    [householdId],
  );
  const now = new Date();
  for (const userRow of members) {
    await addUserToGroup(pool, groupId, userRow, now);
  }
}

export async function listHouseholdMembers(pool, userId) {
  const householdId = await ensureHouseholdForUser(pool, userId);
  const [rows] = await pool.query(
    `SELECT hm.user_id AS userId, hm.role, hm.joined_at AS joinedAt,
            u.display_name AS displayName, u.email, u.photo_url AS photoURL
     FROM household_members hm
     INNER JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = ?
     ORDER BY hm.joined_at`,
    [householdId],
  );
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName ?? null,
    email: r.email,
    photoURL: r.photoURL ?? null,
    role: r.role,
    joinedAt:
      r.joinedAt instanceof Date
        ? r.joinedAt.toISOString()
        : new Date(r.joinedAt).toISOString(),
  }));
}

export async function inviteHouseholdMember(pool, inviterUserId, email) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    const err = new Error('email required');
    err.status = 400;
    throw err;
  }

  const householdId = await ensureHouseholdForUser(pool, inviterUserId);
  const [inviterRole] = await pool.query(
    `SELECT role FROM household_members
     WHERE household_id = ? AND user_id = ?`,
    [householdId, inviterUserId],
  );
  if (!inviterRole.length || inviterRole[0].role !== 'admin') {
    const err = new Error('only household admin can invite members');
    err.status = 403;
    throw err;
  }

  const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [
    normalized,
  ]);
  if (!users.length) {
    const err = new Error('user with this email not found — they must register first');
    err.status = 404;
    throw err;
  }

  const invitee = users[0];
  if (invitee.id === inviterUserId) {
    const err = new Error('cannot invite yourself');
    err.status = 400;
    throw err;
  }

  const [already] = await pool.query(
    `SELECT 1 FROM household_members
     WHERE household_id = ? AND user_id = ?`,
    [householdId, invitee.id],
  );
  if (already.length) {
    const err = new Error('person is already in your household');
    err.status = 409;
    throw err;
  }

  const now = new Date();

  const [inviteeOldHousehold] = await pool.query(
    'SELECT household_id FROM users WHERE id = ?',
    [invitee.id],
  );
  const oldHouseholdId = inviteeOldHousehold[0]?.household_id;

  if (oldHouseholdId && oldHouseholdId !== householdId) {
    const [otherMembers] = await pool.query(
      `SELECT COUNT(*) AS c FROM household_members
       WHERE household_id = ? AND user_id != ?`,
      [oldHouseholdId, invitee.id],
    );
    if (otherMembers[0].c > 0) {
      const err = new Error('user already belongs to another household');
      err.status = 409;
      throw err;
    }
    await pool.query(
      'DELETE FROM household_members WHERE household_id = ? AND user_id = ?',
      [oldHouseholdId, invitee.id],
    );
    await pool.query('DELETE FROM households WHERE id = ?', [oldHouseholdId]);
  }

  await pool.query(
    `INSERT INTO household_members (household_id, user_id, role, joined_at)
     VALUES (?, ?, 'member', ?)`,
    [householdId, invitee.id, now],
  );
  await pool.query('UPDATE users SET household_id = ? WHERE id = ?', [
    householdId,
    invitee.id,
  ]);

  await syncUserToAllHouseholdGroups(pool, householdId, invitee);

  return {
    userId: invitee.id,
    displayName: invitee.display_name ?? null,
    email: invitee.email,
    photoURL: invitee.photo_url ?? null,
    role: 'member',
    joinedAt: now.toISOString(),
  };
}

export async function removeHouseholdMember(pool, adminUserId, memberUserId) {
  const householdId = await getHouseholdId(pool, adminUserId);
  if (!householdId) {
    const err = new Error('household not found');
    err.status = 404;
    throw err;
  }

  const [adminRole] = await pool.query(
    `SELECT role FROM household_members WHERE household_id = ? AND user_id = ?`,
    [householdId, adminUserId],
  );
  if (!adminRole.length || adminRole[0].role !== 'admin') {
    const err = new Error('only household admin can remove members');
    err.status = 403;
    throw err;
  }

  if (memberUserId === adminUserId) {
    const err = new Error('cannot remove yourself');
    err.status = 400;
    throw err;
  }

  const [target] = await pool.query(
    `SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`,
    [householdId, memberUserId],
  );
  if (!target.length) {
    const err = new Error('member not found');
    err.status = 404;
    throw err;
  }

  await pool.query(
    'DELETE FROM household_members WHERE household_id = ? AND user_id = ?',
    [householdId, memberUserId],
  );

  const newHouseholdId = randomUUID();
  const now = new Date();
  await pool.query(
    'INSERT INTO households (id, created_by, created_at) VALUES (?, ?, ?)',
    [newHouseholdId, memberUserId, now],
  );
  await pool.query('UPDATE users SET household_id = ? WHERE id = ?', [
    newHouseholdId,
    memberUserId,
  ]);
  await pool.query(
    `INSERT INTO household_members (household_id, user_id, role, joined_at)
     VALUES (?, ?, 'admin', ?)`,
    [newHouseholdId, memberUserId, now],
  );
}

export async function resourceOwnedByHousehold(
  pool,
  userId,
  table,
  resourceId,
  ownerColumn = 'user_id',
) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT * FROM ${table} WHERE id = ? AND ${ownerColumn} IN (${placeholders})`,
    [resourceId, ...userIds],
  );
  if (!rows.length) {
    const err = new Error(`${table} not found`);
    err.status = 404;
    throw err;
  }
  return rows[0];
}
