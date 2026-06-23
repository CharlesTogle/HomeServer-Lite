import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  AuthServiceConfig,
  AuthServiceContract,
  AuthTokens,
} from './contracts.js';
import {
  queryOptionalRow,
  queryRequiredRow,
  toDate,
  withTransaction,
} from './sqlite-support.js';
import type { AuthenticatedSession, SessionRecord, UserRecord } from '../types/domain.js';
import {
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from '../utils/auth-crypto.js';
import { ConflictError, UnauthorizedError } from '../utils/http-errors.js';

interface UserRow {
  [column: string]: unknown;
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  [column: string]: unknown;
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    createdAt: toDate(row.createdAt),
    email: row.email,
    id: row.id,
    passwordHash: row.passwordHash,
    updatedAt: toDate(row.updatedAt),
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    createdAt: toDate(row.createdAt),
    expiresAt: toDate(row.expiresAt),
    id: row.id,
    refreshTokenHash: row.refreshTokenHash,
    revokedAt: row.revokedAt === null ? null : toDate(row.revokedAt),
    updatedAt: toDate(row.updatedAt),
    userId: row.userId,
  };
}

export class SqliteAuthService implements AuthServiceContract {
  private readonly config: AuthServiceConfig;
  private readonly db: Database.Database;

  public constructor(db: Database.Database, config: AuthServiceConfig) {
    this.db = db;
    this.config = config;
  }

  public async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const userRow = queryRequiredRow<UserRow>(
      this.db,
      'SELECT id, email, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE id = ?',
      [userId],
    );

    const valid = await verifyPassword(currentPassword, userRow.passwordHash);

    if (!valid) {
      throw new UnauthorizedError('Current password is incorrect.');
    }

    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    this.db.prepare(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    ).run(newHash, now, userId);
  }

  public async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const payload = verifyAccessToken(accessToken, this.config.authTokenSecret);
    const sessionRow = queryOptionalRow<SessionRow>(
      this.db,
      'SELECT id, user_id AS "userId", refresh_token_hash AS "refreshTokenHash", expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM sessions WHERE id = ?',
      [payload.sessionId],
    );

    if (sessionRow === null || sessionRow.userId !== payload.userId) {
      throw new UnauthorizedError('Invalid access token.');
    }

    const session = toSessionRecord(sessionRow);
    this.assertSessionIsActive(session);

    const user = await this.getUserById(payload.userId);

    return {
      email: user.email,
      sessionId: session.id,
      userId: user.id,
    };
  }

  public async getUserById(userId: string): Promise<UserRecord> {
    const userRow = queryOptionalRow<UserRow>(
      this.db,
      'SELECT id, email, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE id = ?',
      [userId],
    );

    if (userRow === null) {
      throw new UnauthorizedError('User not found.');
    }

    return toUserRecord(userRow);
  }

  public async login(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    const userRow = queryOptionalRow<UserRow>(
      this.db,
      'SELECT id, email, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE email = ?',
      [normalizedEmail],
    );

    if (
      userRow === null ||
      !(await verifyPassword(password, userRow.passwordHash))
    ) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    return this.issueTokensForUser(toUserRecord(userRow));
  }

  public async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    if (refreshToken !== undefined) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const sessionRow = queryOptionalRow<SessionRow>(
        this.db,
        'SELECT id, user_id AS "userId", refresh_token_hash AS "refreshTokenHash", expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM sessions WHERE refresh_token_hash = ?',
        [refreshTokenHash],
      );

      if (sessionRow !== null) {
        this.revokeSession(sessionRow.id);
        return;
      }
    }

    if (accessToken !== undefined) {
      const auth = await this.authenticate(accessToken);
      this.revokeSession(auth.sessionId);
    }
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessionRow = queryOptionalRow<SessionRow>(
      this.db,
      'SELECT id, user_id AS "userId", refresh_token_hash AS "refreshTokenHash", expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM sessions WHERE refresh_token_hash = ?',
      [refreshTokenHash],
    );

    if (sessionRow === null) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const session = toSessionRecord(sessionRow);
    this.assertSessionIsActive(session);

    const user = await this.getUserById(session.userId);

    return this.issueTokensForUser(user, session);
  }

  public async provisionUser(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = queryOptionalRow<UserRow>(
      this.db,
      'SELECT id FROM users WHERE email = ?',
      [normalizedEmail],
    );

    if (existingUser !== null) {
      throw new ConflictError('A user with that email already exists.');
    }

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, normalizedEmail, passwordHash, now, now);

    return this.issueTokensForUser({
      createdAt: new Date(now),
      email: normalizedEmail,
      id: userId,
      passwordHash,
      updatedAt: new Date(now),
    });
  }

  private assertSessionIsActive(session: SessionRecord): void {
    if (session.revokedAt !== null) {
      throw new UnauthorizedError('Session has been revoked.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Session has expired.');
    }
  }

  private createAccessToken(user: UserRecord, session: SessionRecord): string {
    const expiresAtSeconds =
      Math.floor(Date.now() / 1000) + this.config.accessTokenTtlSeconds;

    return issueAccessToken(
      {
        email: user.email,
        exp: expiresAtSeconds,
        sessionId: session.id,
        userId: user.id,
      },
      this.config.authTokenSecret,
    );
  }

  private issueTokensForUser(
    user: UserRecord,
    existingSession?: SessionRecord,
  ): AuthTokens {
    const session = existingSession ?? {
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
      id: randomUUID(),
      refreshTokenHash: '',
      revokedAt: null,
      updatedAt: new Date(),
      userId: user.id,
    };
    const refreshToken = issueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlSeconds * 1000,
    ).toISOString();

    if (existingSession === undefined) {
      this.db.prepare(
        'INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
      ).run(session.id, user.id, refreshTokenHash, expiresAt, now, now);
    } else {
      this.db.prepare(
        'UPDATE sessions SET expires_at = ?, refresh_token_hash = ?, revoked_at = NULL, updated_at = ? WHERE id = ?',
      ).run(expiresAt, refreshTokenHash, now, session.id);
    }

    return {
      accessToken: this.createAccessToken(user, {
        ...session,
        refreshTokenHash,
        expiresAt: new Date(expiresAt),
        updatedAt: new Date(now),
      }),
      refreshToken,
      user,
    };
  }

  private revokeSession(sessionId: string): void {
    this.db.prepare(
      'UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), new Date().toISOString(), sessionId);
  }
}
