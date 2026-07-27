/**
 * Legacy self-host composition scope.
 *
 * Existing installations persist their one site under this historical ID.
 * Keep the value stable: repository APIs receive it explicitly so selection is
 * scope-bound without renaming or rewriting live data.
 */
export const SELF_HOST_SITE_ID = 'default'
