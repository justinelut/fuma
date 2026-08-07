/**
 * Task 75: generated-site forms from shadcn Field, React Hook Form and zod.
 *
 * THIS FILE DELIBERATELY DOES NOT IMPORT ZOD. The ai-driver-isolation gate bans zod anywhere under
 * src/ or server/ with no allowed callers, because the AI drivers pass TypeBox schemas through as
 * JSON Schema and apps/studio must carry no zod dependency at all (task 23's validator boundary).
 * That gate is right and its strength comes from having no exceptions, so the behavioural evidence
 * for the emitted schemas lives where it belongs instead:
 *
 *   - THE TYPES are proven by compiling the emitted form against the REAL pinned zod 4.4.3,
 *     react-hook-form 7.84.0 and @hookform/resolvers 5.7.1. That compile found three genuine bugs.
 *   - THE RUNTIME BEHAVIOUR was measured against real zod 4.4.3 and the outputs are recorded beside
 *     each assertion, so the reason a branch exists is checkable rather than asserted.
 *
 * Measured with zod 4.4.3:
 *   z.email().optional().safeParse('')            -> success FALSE
 *   z.boolean().safeParse(false)                  -> success TRUE
 *   z.boolean().refine(v => v === true) on false  -> success FALSE, on true -> TRUE
 *   z.string().refine(v => list.includes(v)) ''   -> success FALSE
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FORM_CONTRACT,
  type FormDefinition,
  type FormField,
  defaultsSource,
  fieldPrimitivesSource,
  fieldSchemaExpression,
  formComponentSource,
  inputTypeFor,
  reviewForm,
  schemaSource,
} from '../../core/generatedSite/formScaffold'
import { allBaselinePackages } from '../../core/generatedSite/libraryBaseline'

const STUDIO = join(import.meta.dir, '..', '..', '..')

const field = (over: Partial<FormField> & Pick<FormField, 'name' | 'kind'>): FormField => ({
  label: over.name, required: false, ...over,
}) as FormField

describe('DEFECT 1: an optional email must accept the empty string an untouched input submits', () => {
  it('the emitted optional email admits the empty string explicitly', () => {
    // MEASURED: z.email().optional().safeParse('') is FALSE, and '' is exactly what an untouched
    // input submits - the DOM has no undefined for an input value. So the naive spelling makes an
    // OPTIONAL field impossible to leave blank.
    const source = fieldSchemaExpression(field({ name: 'alt', kind: 'email' }))
    expect(source).toContain('z.literal("")')
    expect(source).toContain('z.email(')
    expect(source).toContain('.optional()')
  })

  it('and the same holds for an optional url and tel', () => {
    for (const kind of ['url', 'tel'] as const) {
      expect(fieldSchemaExpression(field({ name: 'x', kind }))).toContain('z.literal("")')
    }
  })

  it('while a REQUIRED email does NOT admit blank', () => {
    const source = fieldSchemaExpression(field({ name: 'e', kind: 'email', required: true }))
    expect(source).toBe('z.email("Enter a valid email address")')
    expect(source).not.toContain('z.literal("")')
  })
})

describe('DEFECT 2: a required checkbox must refuse being left unchecked', () => {
  it('is a refinement, not a bare boolean, because a bare boolean accepts false', () => {
    // MEASURED: z.boolean().safeParse(false) succeeds, so a consent box marked required would pass
    // UNCHECKED - the row stored with the agreement recorded as given.
    const source = fieldSchemaExpression(field({ name: 'consent', label: 'Consent', kind: 'checkbox', required: true }))
    expect(source).toContain('z.boolean().refine((value) => value === true')
    expect(source).toContain('Consent is required')
  })

  it('and NOT z.literal(true), or the unchecked default could not compile', () => {
    // This is the distinction compilation proved: z.literal(true) makes false UNREPRESENTABLE in the
    // type, and the form's initial state is exactly false. A refinement keeps the state expressible
    // (input type boolean) while validation still refuses it - MEASURED false -> FALSE, true -> TRUE.
    const source = fieldSchemaExpression(field({ name: 'consent', label: 'Consent', kind: 'checkbox', required: true }))
    expect(source).not.toContain('z.literal(true')
  })

  it('an OPTIONAL checkbox stays a plain optional boolean, because unchecked is a real answer', () => {
    expect(fieldSchemaExpression(field({ name: 'news', kind: 'checkbox' }))).toBe('z.boolean().optional()')
  })
})

describe('other field kinds', () => {
  it('a number field coerces, because an input value is a string even with type=number', () => {
    const source = fieldSchemaExpression(field({ name: 'qty', kind: 'number', required: true }))
    expect(source).toContain('z.coerce.number(')
  })

  it('a required text field demands a minimum, or blank submits successfully', () => {
    const source = fieldSchemaExpression(field({ name: 'name', label: 'Name', kind: 'text', required: true }))
    expect(source).toContain('.min(1,')
  })

  it('a select is a refined string listing exactly its options', () => {
    // MEASURED: the refinement refuses '' and refuses an unlisted value, while an enum would make
    // the "Choose…" placeholder unrepresentable as form state.
    const source = fieldSchemaExpression(
      field({ name: 'topic', kind: 'select', required: true, options: ['sales', 'support'] }),
    )
    expect(source).toContain('z.string().refine')
    expect(source).toContain('["sales", "support"].includes(value)')
    expect(source).not.toContain('z.enum(')
  })
})

const contact: FormDefinition = {
  symbol: 'ContactForm',
  table: 'contact_submissions',
  successMessage: 'Thanks — we will be in touch.',
  fields: [
    { name: 'name', label: 'Your name', kind: 'text', required: true },
    { name: 'email', label: 'Email', kind: 'email', required: true },
    { name: 'topic', label: 'Topic', kind: 'select', required: true, options: ['Sales', 'Support'] },
    { name: 'message', label: 'Message', kind: 'textarea', required: true, description: 'Tell us what you need.' },
    { name: 'consent', label: 'I agree to be contacted', kind: 'checkbox', required: true },
  ],
}

describe('the whole emitted schema', () => {
  const built = schemaSource(contact)

  it('declares one entry per field, so nothing submitted is unvalidated', () => {
    for (const f of contact.fields) expect(built).toContain(`  ${f.name}: z.`)
  })

  it('is a single z.object, which is what both the form and the endpoint validate against', () => {
    expect(built.startsWith('const schema = z.object({')).toBe(true)
    // One schema is the point: the form and the table cannot disagree about which fields are
    // mandatory if there is only one statement of it.
    expect(built.match(/z\.object\(/g)).toHaveLength(1)
  })

  it('and the required consent field carries its refinement, not a bare boolean', () => {
    expect(built).toContain('consent: z.boolean().refine')
  })
})

describe('defaults control every input from the first render', () => {
  it('a checkbox defaults to false and a text field to the empty string', () => {
    const source = defaultsSource(contact)
    expect(source).toContain('consent: false')
    expect(source).toContain('name: ""')
  })

  it('every field appears, or React Hook Form leaves that input uncontrolled', () => {
    const source = defaultsSource(contact)
    for (const f of contact.fields) expect(source).toContain(`${f.name}:`)
  })
})

describe('the emitted component follows task 63\'s decision', () => {
  const source = formComponentSource(contact, '/api/public/forms')

  it('is a client component, because a submission is a visitor interaction', () => {
    expect(source.startsWith('"use client"')).toBe(true)
  })

  it('fetches the token at SUBMIT time rather than rendering it into the page', () => {
    expect(source).toContain('/api/public/forms/token')
    expect(source).toContain('identical for every visitor')
  })

  it('posts to the platform endpoint, not a server action or a route handler', () => {
    expect(source).toContain('await fetch("/api/public/forms"')
    expect(source).not.toContain('use server')
  })

  it('names the table so the submission lands where the form says', () => {
    expect(source).toContain('"contact_submissions"')
  })

  it('reports a failure with what to do next and that the answers survive', () => {
    // "Something went wrong" leaves somebody who filled in a long form unsure whether to retype it.
    expect(source).toContain('Your answers are still here')
  })

  it('disables the submit button while sending, so one click is one submission', () => {
    expect(source).toContain('disabled={form.formState.isSubmitting}')
  })

  it('carries noValidate, so zod decides validity rather than the browser doing it differently', () => {
    expect(source).toContain('noValidate')
  })

  it('types the form STATE as the input type and the submission as the output type', () => {
    // The real bug compilation found: z.infer is the OUTPUT type, but a form's state is the INPUT
    // type - a coerced number starts as a string, a select starts on a placeholder, a required
    // checkbox starts false. Typing the form with the output type makes every default a type error.
    expect(source).toContain('type Values = z.input<typeof schema>')
    expect(source).toContain('type Submitted = z.output<typeof schema>')
    expect(source).toContain('useForm<Values, unknown, Submitted>')
    expect(source).not.toContain('z.infer<typeof schema>')
  })
})

describe('the accessible wiring a hand-written form usually omits', () => {
  const source = formComponentSource(contact, '/api/public/forms')

  it('every field links its error to its control', () => {
    for (const f of contact.fields) {
      expect(source).toContain(`id="${f.name}-error"`)
      expect(source).toContain(`aria-describedby={`)
    }
  })

  it('marks the control invalid, not only the message red', () => {
    expect(source).toContain('aria-invalid={Boolean(form.formState.errors.name)}')
  })

  it('lists BOTH ids when a field has a description AND an error', () => {
    // Naming only the description would leave the error drawn but never announced.
    expect(source).toContain('message-description message-error')
  })

  it('every label is bound to its control by id', () => {
    for (const f of contact.fields) expect(source).toContain(`htmlFor="${f.name}"`)
  })
})

describe('the Field primitives', () => {
  const source = fieldPrimitivesSource()

  it('are composition, not one Form component', () => {
    for (const name of ['Field', 'FieldLabel', 'FieldDescription', 'FieldError']) {
      expect(source).toContain(`function ${name}(`)
    }
  })

  it('resolve cn from the tenant path the starter emits', () => {
    expect(source).toContain('from "@/lib/utils"')
    expect(source).not.toContain('@admin/')
  })

  it('render nothing for an absent error rather than an empty announced paragraph', () => {
    expect(source).toContain('if (!children) return null')
  })

  it('give the error an alert role so it is announced when it appears', () => {
    expect(source).toContain('role="alert"')
  })
})

describe('the review catches definitions that produce wrong data', () => {
  it('a sound form reports nothing', () => {
    expect(reviewForm(contact)).toHaveLength(0)
  })

  it('two fields with one name, which silently overwrite each other', () => {
    const problems = reviewForm({ ...contact, fields: [
      { name: 'a', label: 'A', kind: 'text', required: true },
      { name: 'a', label: 'Also A', kind: 'text', required: true },
    ] })
    expect(problems.map((p) => p.code)).toContain('duplicate-field-name')
    expect(problems[0]!.message).toContain('only one value')
  })

  it('a name that cannot be a column', () => {
    const problems = reviewForm({ ...contact, fields: [{ name: 'first name', label: 'X', kind: 'text', required: true }] })
    expect(problems.map((p) => p.code)).toContain('name-not-a-column')
  })

  it('a select with no options, which cannot be satisfied', () => {
    const problems = reviewForm({ ...contact, fields: [{ name: 'topic', label: 'Topic', kind: 'select', required: true, options: [] }] })
    expect(problems.map((p) => p.code)).toContain('select-without-options')
  })

  it('an unlabelled field', () => {
    const problems = reviewForm({ ...contact, fields: [{ name: 'x', label: '  ', kind: 'text', required: true }] })
    expect(problems.map((p) => p.code)).toContain('field-without-label')
  })

  it('and a form with no fields at all', () => {
    expect(reviewForm({ ...contact, fields: [] }).map((p) => p.code)).toContain('form-without-fields')
  })
})

describe('the dependencies it needs are pinned for a generated site', () => {
  it('zod, react-hook-form and the resolver', () => {
    const pinned = allBaselinePackages().map((p) => p.name)
    for (const name of ['zod', 'react-hook-form', '@hookform/resolvers']) {
      expect(pinned).toContain(name)
    }
  })

  it('and zod is version 4, which is what the emitted idioms require', () => {
    // z.email() as a top level function is zod 4; on zod 3 it is z.string().email().
    const zod = allBaselinePackages().find((p) => p.name === 'zod')
    expect(zod?.version.startsWith('4.')).toBe(true)
  })

  it('the admin deliberately does NOT carry them, which is why this is emitted rather than copied', () => {
    const studioPackage = JSON.parse(
      readFileSync(join(STUDIO, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const deps = studioPackage.dependencies ?? {}
    expect(deps['react-hook-form']).toBeUndefined()
    expect(deps['zod']).toBeUndefined()
  })
})

describe('input types', () => {
  it('map each kind to the control that gives the right keyboard on a phone', () => {
    expect(inputTypeFor('email')).toBe('email')
    expect(inputTypeFor('tel')).toBe('tel')
    expect(inputTypeFor('number')).toBe('number')
    expect(inputTypeFor('text')).toBe('text')
  })
})

describe('the contract is stated', () => {
  it('naming the validator, the submission route, the token timing and the one schema', () => {
    expect(FORM_CONTRACT.validator).toContain('zod')
    expect(FORM_CONTRACT.submission).toContain('no Next runtime')
    expect(FORM_CONTRACT.token).toContain('distinguishes nothing')
    expect(FORM_CONTRACT.oneSchema).toContain('cannot disagree')
  })
})
