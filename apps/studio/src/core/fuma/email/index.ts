export {
  EMAIL_DOCUMENT_MAX_BYTES,
  EMAIL_DOCUMENT_MAX_DEPTH,
  EMAIL_DOCUMENT_MAX_NODES,
  EMAIL_DOCUMENT_MAX_OUTPUT_BYTES,
  EMAIL_DOCUMENT_VERSION,
  EmailDocumentSchema,
  EmailDocumentValidationError,
  EmailNodeSchema,
  EmailStyleSchema,
  parseEmailDocument,
  validateEmailDocument,
} from './document'
export type {
  EmailDocument,
  EmailDocumentDiagnostic,
  EmailDocumentDiagnosticCode,
  EmailDocumentValidationResult,
  EmailNode,
  EmailStyle,
} from './document'
