import { Type, type Static, type TSchema } from '@sinclair/typebox'

export const PublicDatasetVersionSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9._:-]+$',
})
export type PublicDatasetVersion = Static<typeof PublicDatasetVersionSchema>

export const PublicReadMetadataSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  datasetVersion: PublicDatasetVersionSchema,
  etag: Type.String({
    minLength: 3,
    maxLength: 160,
    pattern: '^(?:W/)?"[^"\\r\\n]{1,156}"$',
  }),
}, { additionalProperties: false })
export type PublicReadMetadata = Static<typeof PublicReadMetadataSchema>

export function createPublicReadEnvelopeSchema<TData extends TSchema>(dataSchema: TData) {
  return Type.Object({
    data: dataSchema,
    meta: PublicReadMetadataSchema,
  }, { additionalProperties: false })
}
