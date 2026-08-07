/**
 * Generated-site forms: shadcn Field composition, React Hook Form and zod.
 *
 * WHY THIS IS EMITTED AS SOURCE RATHER THAN READ FROM THE ADMIN, which is a genuine difference from
 * the other shadcn components: THERE IS NO Field OR Form COMPONENT IN THE ADMIN TO COPY. Task 23
 * removed zod, react-hook-form and @hookform/resolvers from apps/studio and deleted
 * src/admin/fuma/ui/form.tsx, because the validator boundary gives TypeBox to Fuma and zod to
 * generated sites. So the admin deliberately cannot host the component a tenant form needs, and the
 * field vocabulary is written for the tenant instead of rewritten from ours.
 *
 * WHERE THE SUBMISSION GOES IS ALREADY DECIDED, by task 63 and for reasons that are facts rather
 * than preferences: a release is a set of FILES in object storage, so there is no Next runtime in
 * the tenant's app for a server action or a route handler to run in - both work in `next dev` and
 * fail only once published. The form posts to the platform endpoint, and the per-attempt token is
 * FETCHED AT SUBMIT TIME because a token baked into a public permanent file is identical for every
 * visitor and therefore distinguishes nothing.
 *
 * TWO VALIDATION DEFECTS THIS MODULE EXISTS TO AVOID, both MEASURED against the pinned zod 4.4.3
 * rather than reasoned about:
 *
 * 1. AN OPTIONAL EMAIL OR URL REJECTS THE EMPTY STRING. `z.email().optional()` fails on '' - and ''
 *    is exactly what an untouched text input submits, because the DOM has no concept of undefined
 *    for an input value. So the obvious spelling makes an OPTIONAL field impossible to leave blank:
 *    the visitor gets "invalid email" on a field they deliberately skipped, and the form cannot be
 *    submitted at all. Measured false for '' and fixed by accepting the empty string explicitly.
 *
 * 2. A REQUIRED CHECKBOX AS `z.boolean()` ACCEPTS false. Measured: safeParse({consent:false})
 *    succeeds. So a consent checkbox marked required passes UNCHECKED - the form submits, the row is
 *    stored, and the agreement was never given. `z.literal(true, message)` is the only spelling that
 *    refuses it.
 */

/** What a field can be. Deliberately small: each entry has a distinct control and a distinct schema. */
export type FieldKind =
  | 'text'
  | 'email'
  | 'url'
  | 'tel'
  | 'number'
  | 'textarea'
  | 'checkbox'
  | 'select'

export type FormField = Readonly<{
  /** Property name in the submitted object and column in the tenant's table. */
  name: string
  /** Visible label. */
  label: string
  kind: FieldKind
  required: boolean
  /** Help text rendered under the control and linked to it for assistive technology. */
  description?: string
  /** Options for a select. Ignored for every other kind. */
  options?: readonly string[]
}>

export type FormDefinition = Readonly<{
  /** Component name, e.g. 'ContactForm'. */
  symbol: string
  /** The CMS table submissions land in. */
  table: string
  fields: readonly FormField[]
  /** What the visitor sees after a successful submission. */
  successMessage: string
}>

/**
 * The zod expression for one field.
 *
 * Every branch is chosen from measured behaviour, not from what reads naturally.
 */
export function fieldSchemaExpression(field: FormField): string {
  const message = (text: string) => JSON.stringify(text)

  if (field.kind === 'checkbox') {
    // A required checkbox is boolean-with-a-refinement rather than z.literal(true), and the reason is
    // the form rather than the data. z.boolean() alone ACCEPTS false, so the agreement would be
    // recorded as given when the box was never ticked - measured. But z.literal(true) makes false
    // UNREPRESENTABLE in the type, and the form's initial state is exactly false, so the default
    // value stops compiling. A refinement keeps the state expressible and still refuses it.
    return field.required
      ? `z.boolean().refine((value) => value === true, ${message(`${field.label} is required`)})`
      : 'z.boolean().optional()'
  }

  if (field.kind === 'select') {
    const options = field.options ?? []
    // Refined string rather than z.enum for the same reason: a select starts on the empty
    // placeholder, which is not one of its members, so an enum makes the initial state
    // unrepresentable. The refinement still refuses both the placeholder and any value the select
    // could not have produced.
    const list = `[${options.map((option) => JSON.stringify(option)).join(', ')}]`
    const base = `z.string().refine((value) => ${list}.includes(value), ${message(`Choose a ${field.label.toLowerCase()}`)})`
    return field.required ? base : `z.union([${base}, z.literal("")]).optional()`
  }

  if (field.kind === 'number') {
    // coerce, because an input's value is a STRING even with type="number" - z.number() would refuse
    // every submission with a message about a type the visitor cannot see.
    const base = `z.coerce.number(${message(`${field.label} must be a number`)})`
    return field.required ? base : `${base}.optional()`
  }

  const formatted =
    field.kind === 'email' ? `z.email(${message('Enter a valid email address')})`
    : field.kind === 'url' ? `z.url(${message('Enter a valid URL, including https://')})`
    : field.kind === 'tel' ? `z.string().min(4, ${message('Enter a contact number')})`
    : `z.string()`

  if (field.required) {
    // A plain string still needs a minimum, or a blank required field submits successfully.
    return field.kind === 'text' || field.kind === 'textarea'
      ? `z.string().min(1, ${message(`${field.label} is required`)})`
      : formatted
  }

  // OPTIONAL, and this is the measured case: an untouched input submits '', which z.email() and
  // z.url() both refuse. Accepting the empty string explicitly is what makes "optional" true.
  if (field.kind === 'email' || field.kind === 'url' || field.kind === 'tel') {
    return `z.union([${formatted}, z.literal("")]).optional()`
  }
  return 'z.string().optional()'
}

/** The whole schema, which is also what the platform endpoint validates against. */
export function schemaSource(form: FormDefinition): string {
  const lines = form.fields.map(
    (field) => `  ${field.name}: ${fieldSchemaExpression(field)},`,
  )
  return `const schema = z.object({\n${lines.join('\n')}\n})`
}

/** Default values, so React Hook Form controls every input from the first render. */
export function defaultsSource(form: FormDefinition): string {
  const lines = form.fields.map((field) => {
    if (field.kind === 'checkbox') return `    ${field.name}: false,`
    if (field.kind === 'number') return `    ${field.name}: undefined,`
    return `    ${field.name}: "",`
  })
  return `{\n${lines.join('\n')}\n  }`
}

/** Which HTML input type a kind renders with. */
export function inputTypeFor(kind: FieldKind): string {
  switch (kind) {
    case 'email': return 'email'
    case 'url': return 'url'
    case 'tel': return 'tel'
    case 'number': return 'number'
    default: return 'text'
  }
}

export type FormProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews a form definition for the mistakes that produce a working-looking form with wrong data.
 */
export function reviewForm(form: FormDefinition): readonly FormProblem[] {
  const problems: FormProblem[] = []
  const seen = new Set<string>()

  for (const field of form.fields) {
    if (seen.has(field.name)) {
      problems.push({
        code: 'duplicate-field-name',
        message: `Two fields are named ${field.name}, so one silently overwrites the other in the submitted object and only one value is ever stored.`,
      })
    }
    seen.add(field.name)

    if (!/^[a-z][a-zA-Z0-9_]*$/.test(field.name)) {
      problems.push({
        code: 'name-not-a-column',
        message: `${field.name} is not usable as a property and column name, so the submission and the table cannot agree on where the value goes.`,
      })
    }

    if (field.kind === 'select' && (field.options ?? []).length === 0) {
      problems.push({
        code: 'select-without-options',
        message: `${field.name} is a select with no options, so it renders an empty control the visitor cannot satisfy while the field is still required.`,
      })
    }

    if (field.label.trim().length === 0) {
      problems.push({
        code: 'field-without-label',
        message: `${field.name} has no label, so the control is unlabelled for assistive technology and ambiguous for everyone else.`,
      })
    }
  }

  if (form.fields.length === 0) {
    problems.push({
      code: 'form-without-fields',
      message: 'A form with no fields submits an empty object, which stores a row carrying nothing.',
    })
  }

  return Object.freeze(problems)
}

/**
 * The Field primitives a generated site receives.
 *
 * Composition rather than one Form component: a field is a label, a control, optional help text and
 * an error, and expressing that as separate pieces is what lets a site lay them out differently
 * without reimplementing the accessible wiring.
 */
export function fieldPrimitivesSource(): string {
  return `import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A field groups a label, a control, its description and its error.
 *
 * The pieces are separate so a site can lay them out its own way. What they must not lose is the
 * wiring: aria-describedby links the description AND the error to the control, and aria-invalid
 * marks it. Without those the error is drawn on screen and invisible to a screen reader, which is
 * the commonest accessibility failure in a hand-written form.
 */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field" className={cn("flex flex-col gap-2", className)} {...props} />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  // Renders nothing when there is no error, rather than an empty paragraph that still occupies
  // space and is still announced.
  if (!children) return null
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  )
}

export { Field, FieldLabel, FieldDescription, FieldError }
`
}

/**
 * The form component itself.
 *
 * A client component, which task 63 established is the right answer here rather than a cost: a
 * submission is a visitor interaction, and the alternative - a plain HTML form doing a cross-origin
 * POST - navigates the visitor off the site to a response we would then have to redirect back.
 */
export function formComponentSource(form: FormDefinition, endpointPath: string): string {
  const controls = form.fields.map((field) => renderField(field)).join('\n')

  return `"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert } from "@/components/ui/alert"
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field"

${schemaSource(form)}

/**
 * A FORM HOLDS THE INPUT TYPE, NOT THE OUTPUT TYPE, and conflating them does not compile.
 *
 * z.infer is the OUTPUT type - what exists after validation passed. But the form's state is what
 * exists BEFORE it: a required consent box starts unchecked, so its state must hold false even
 * though \`z.literal(true)\` infers the type \`true\`; a select starts on the empty placeholder, which
 * is not one of its enum members; and a coerced number starts as a string. Typing the form with the
 * output type makes every one of those initial values a type error.
 *
 * So Values is the input type (the state React Hook Form manages) and Submitted is the output type
 * (what the resolver produces and the endpoint receives).
 */
type Values = z.input<typeof schema>
type Submitted = z.output<typeof schema>

export function ${form.symbol}() {
  const [submitted, setSubmitted] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)
  const form = useForm<Values, unknown, Submitted>({
    resolver: zodResolver(schema),
    defaultValues: ${defaultsSource(form)},
  })

  async function onSubmit(values: Submitted) {
    setFailed(null)
    try {
      // The token is fetched HERE rather than rendered into the page. A published page is a static
      // file served from object storage, so a token baked into it would be public, permanent and
      // identical for every visitor - it could no longer distinguish one submission from another.
      const issued = await fetch("${endpointPath}/token", { method: "POST" })
      if (!issued.ok) throw new Error("token")
      const { token } = (await issued.json()) as { token: string }

      const sent = await fetch("${endpointPath}", {
        method: "POST",
        headers: { "content-type": "application/json", "x-form-token": token },
        body: JSON.stringify({ table: ${JSON.stringify(form.table)}, values }),
      })
      if (!sent.ok) throw new Error("submit")
      setSubmitted(true)
    } catch {
      // Says what to do next. "Something went wrong" leaves somebody who filled in a long form with
      // no idea whether their answers survived.
      setFailed("We could not send that. Your answers are still here — please try again.")
    }
  }

  if (submitted) {
    return <Alert role="status">{${JSON.stringify(form.successMessage)}}</Alert>
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
${controls}
      {failed ? <Alert role="alert">{failed}</Alert> : null}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Sending…" : "Send"}
      </Button>
    </form>
  )
}
`
}

/** One field's markup, with the accessible wiring that a hand-written form usually omits. */
function renderField(field: FormField): string {
  const id = field.name
  const errorId = `${field.name}-error`
  const describeId = field.description ? `${field.name}-description` : null
  // Both ids are listed when both exist, or the description is announced and the error is not.
  const described = describeId ? `\`${describeId} ${errorId}\`` : `"${errorId}"`
  const description = describeId
    ? `\n        <FieldDescription id="${describeId}">${escapeText(field.description!)}</FieldDescription>`
    : ''

  if (field.kind === 'checkbox') {
    return `      <Field>
        <div className="flex items-center gap-2">
          <Checkbox
            id="${id}"
            checked={form.watch("${field.name}") === true}
            onCheckedChange={(checked) => form.setValue("${field.name}", checked === true, { shouldValidate: true })}
            aria-invalid={Boolean(form.formState.errors.${field.name})}
            aria-describedby={${described}}
          />
          <FieldLabel htmlFor="${id}">${escapeText(field.label)}</FieldLabel>
        </div>${description}
        <FieldError id="${errorId}">{form.formState.errors.${field.name}?.message}</FieldError>
      </Field>`
  }

  if (field.kind === 'select') {
    const options = (field.options ?? [])
      .map((option) => `          <option value=${JSON.stringify(option)}>${escapeText(option)}</option>`)
      .join('\n')
    // A native select rather than the shadcn Select here, because Radix's Select is not a form
    // control the browser submits and wiring it to React Hook Form needs a controller. The styled
    // component is available when a site wants it; the default stays the one that just works.
    return `      <Field>
        <FieldLabel htmlFor="${id}">${escapeText(field.label)}</FieldLabel>
        <select
          id="${id}"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          aria-invalid={Boolean(form.formState.errors.${field.name})}
          aria-describedby={${described}}
          {...form.register("${field.name}")}
        >
          <option value="">Choose…</option>
${options}
        </select>${description}
        <FieldError id="${errorId}">{form.formState.errors.${field.name}?.message}</FieldError>
      </Field>`
  }

  const control = field.kind === 'textarea'
    ? `        <Textarea
          id="${id}"
          aria-invalid={Boolean(form.formState.errors.${field.name})}
          aria-describedby={${described}}
          {...form.register("${field.name}")}
        />`
    : `        <Input
          id="${id}"
          type="${inputTypeFor(field.kind)}"
          aria-invalid={Boolean(form.formState.errors.${field.name})}
          aria-describedby={${described}}
          {...form.register("${field.name}")}
        />`

  return `      <Field>
        <FieldLabel htmlFor="${id}">${escapeText(field.label)}</FieldLabel>
${control}${description}
        <FieldError id="${errorId}">{form.formState.errors.${field.name}?.message}</FieldError>
      </Field>`
}

/** JSX text cannot carry a bare brace or angle bracket. */
function escapeText(text: string): string {
  return text.replace(/[{}<>]/g, (char) => `{${JSON.stringify(char)}}`)
}

/** Recorded so the emitted form's contract is checkable rather than described. */
export const FORM_CONTRACT = Object.freeze({
  validator: 'zod, which the generated-site baseline pins and the admin deliberately does not carry.',
  submission: 'The platform endpoint, because a released site is files in object storage with no Next runtime to host an action or a route handler.',
  token: 'Fetched at submit time, because a token baked into a public permanent file is identical for every visitor and distinguishes nothing.',
  oneSchema: 'The same zod schema states what the form requires and what the endpoint accepts, so the form and the table cannot disagree about which fields are mandatory.',
})
