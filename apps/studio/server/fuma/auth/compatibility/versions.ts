export const FUMA_AUTH_COMPATIBILITY_PACKAGES = Object.freeze({
  '@better-auth/drizzle-adapter': Object.freeze({
    version: '1.6.25',
    repository: 'https://github.com/better-auth/better-auth.git#packages/drizzle-adapter',
    integrity: 'sha512-ru/DeKjFPQUVeKkxF/ScazmPqIY7lwfkAV5Yt4j24wmn1Y8vFwoiPRnHgXUeZqBs10+nubaRwEqLF39CP6EhRw==',
    os: null,
    cpu: null,
  }),
  auth: Object.freeze({
    version: '1.6.25',
    repository: 'https://github.com/better-auth/better-auth.git#packages/cli',
    integrity: 'sha512-wyNvrDEQkcP4Lyo2GzYkngFstcswInItrqmJD3lz+Dkm5iceoNoBojfA+7xcEcsQDuFKsDU2Ho+VGllhs5a8lw==',
    os: null,
    cpu: null,
  }),
  'better-auth': Object.freeze({
    version: '1.6.25',
    repository: 'https://github.com/better-auth/better-auth.git#packages/better-auth',
    integrity: 'sha512-fvoq+oCO+FF5fpP3XfU7znRyGFpHB77UG2EyxsKNy+Cak7Q5pELu+auvvDveQbWQxcoKugZ7jYQQPFQLpUTGOw==',
    os: null,
    cpu: null,
  }),
  'drizzle-orm': Object.freeze({
    version: '0.45.2',
    repository: 'https://github.com/drizzle-team/drizzle-orm.git',
    integrity: 'sha512-kY0BSaTNYWnoDMVoyY8uxmyHjpJW1geOmBMdSSicKo9CIIWkSxMIj2rkeSR51b8KAPB7m+qysjuHme5nKP+E5Q==',
    os: null,
    cpu: null,
  }),
  postgres: Object.freeze({
    version: '3.4.9',
    repository: 'https://github.com/porsager/postgres.git',
    integrity: 'sha512-GD3qdB0x1z9xgFI6cdRD6xu2Sp2WCOEoe3mtnyB5Ee0XrrL5Pe+e4CCnJrRMnL1zYtRDZmQQVbvOttLnKDLnaw==',
    os: null,
    cpu: null,
  }),
})

export const FUMA_AUTH_PROVEN_BUN_RANGE = '>=1.3.0 <1.4.0'
export const FUMA_AUTH_ARM64_GATE = 'bun test server/fuma/auth/compatibility/compatibility.test.ts'
export const FUMA_AUTH_POSTGRES_GATE = 'FUMA_AUTH_COMPAT_POSTGRES_URL=postgres://… bun test server/fuma/auth/compatibility/compatibility.test.ts'
