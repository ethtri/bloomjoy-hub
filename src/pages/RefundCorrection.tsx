import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { isLocalUatDemoForced } from '@/lib/refundOperations';
import { correctionChoices, correctionFields, correctionLabels, isCorrectionToken, validateCorrectionAnswers,
  type CorrectionAnswer, type CorrectionAnswers, type CorrectionContext, type CorrectionField,
} from '../../supabase/functions/_shared/refund-correction';

const tokenKey = 'bloomjoy-refund-correction-v1';
const initialToken = () => {
  const fragment = window.location.hash;
  const token = fragment ? new URLSearchParams(fragment.slice(1)).get('token') ?? '' : sessionStorage.getItem(tokenKey) ?? '';
  if (fragment && !isCorrectionToken(token)) sessionStorage.removeItem(tokenKey);
  return isCorrectionToken(token) ? token : '';
};
const controlClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const demoContext = (search: string): CorrectionContext => {
  const params = new URLSearchParams(search);
  const wallet = params.get('payment') === 'wallet';
  const cash = params.get('payment') === 'cash';
  return { state: params.get('state') === 'expired' ? 'unavailable' : 'ready', publicReference: 'RF-DEMO', version: 1,
    locale: params.get('lang') === 'es' ? 'es' : 'en', timezone: 'America/Los_Angeles',
    requestedFields: cash ? ['incident_time', 'amount'] : ['card_last4'],
    allowedFields: correctionFields.filter((field) => field !== 'zelle_payment_contact'),
    values: { location_or_machine: 'Example mall', incident_date: '2026-09-03', incident_time: '14:30', amount: '7.00',
      payment_method: cash ? 'cash' : 'card', payment_interaction: wallet ? 'phone_watch_wallet' : cash ? 'cash' : 'tap_card',
      ...(wallet ? { wallet_provider: 'apple_pay' } : {}), ...(!cash ? { card_last4: '1234', card_network: 'visa' } : {}) },
  };
};

export default function RefundCorrectionPage() {
  const location = useLocation();
  const [token, setToken] = useState(initialToken);
  const demo = isLocalUatDemoForced();
  const [answers, setAnswers] = useState<CorrectionAnswers>({});
  const [reviewOthers, setReviewOthers] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [received, setReceived] = useState(false);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ['refund-correction', token],
    enabled: !demo && Boolean(token), retry: false,
    queryFn: async () => {
      const response = await invokeEdgeFunction<{ correction: CorrectionContext }>('refund-case-intake', { action: 'inspectPurchaseCorrection', token }, { includeUserAuth: false });
      return response.correction;
    },
  });
  const context = demo ? demoContext(location.search) : query.data;
  const es = context?.locale === 'es';
  const copy = (english: string, spanish: string) => es ? spanish : english;
  useEffect(() => {
    if (token) sessionStorage.setItem(tokenKey, token);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta);
    return () => meta.remove();
  }, [token]);
  useEffect(() => {
    const openLink = () => { setToken(initialToken()); setAnswers({}); setReceived(false); setError(''); };
    window.addEventListener('hashchange', openLink);
    return () => window.removeEventListener('hashchange', openLink);
  }, []);
  useEffect(() => { if (received) resultRef.current?.focus(); }, [received]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const update = (field: CorrectionField, answer: CorrectionAnswer) => {
    setAnswers((prior) => {
      const next = { ...prior, [field]: answer };
      if (field === 'payment_method' || field === 'payment_interaction') {
        for (const dependent of ['card_last4','wallet_provider','card_network'] as const) delete next[dependent];
        if (field === 'payment_method') delete next.payment_interaction;
      }
      return next;
    });
    if (field === 'payment_method' || field === 'payment_interaction') setReviewOthers(true);
    setError('');
  };
  const values = context?.values ?? {};
  const effective = (field: CorrectionField) => answers[field]?.disposition === 'changed' ? answers[field]?.value : values[field];
  const wallet = effective('payment_interaction') === 'phone_watch_wallet';
  const cash = effective('payment_method') === 'cash';
  const requested = context?.requestedFields ?? [];
  const fields = (context?.allowedFields ?? []).filter((field) => requested.includes(field) || (reviewOthers &&
    (!cash || !['card_last4', 'card_network', 'wallet_provider'].includes(field)) && (wallet || field !== 'wallet_provider')));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!context) return;
    setError('');
    let validated: CorrectionAnswers;
    try { validated = validateCorrectionAnswers(answers, context); }
    catch { setError(copy('Choose an answer for each requested detail. You can choose “I’m not sure” without guessing.', 'Elija una respuesta para cada detalle solicitado. Puede elegir “No estoy seguro” sin adivinar.')); return; }
    setSaving(true);
    try {
      if (!demo) await invokeEdgeFunction('refund-case-intake', { action: 'submitPurchaseCorrection', token, version: context.version, answers: validated }, { includeUserAuth: false });
      setReceived(true);
    } catch {
      setError(copy('We couldn’t save this response. Your answers are still here. Try again, or reply to your Bloomjoy email for help with this same request.', 'No pudimos guardar la respuesta. Sus respuestas siguen aquí. Inténtelo de nuevo o responda al correo de Bloomjoy para obtener ayuda con esta misma solicitud.'));
    } finally { setSaving(false); }
  };

  return <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12" lang={es ? 'es' : 'en'}>
    <div className="mx-auto max-w-xl">
      <p className="mb-8 font-display text-2xl font-bold">Bloomjoy</p>
      {query.isFetching && !context ? <p role="status">Opening your secure refund request…</p>
        : received || context?.state === 'received' ? <section aria-live="polite">
          <CheckCircle2 aria-hidden className="mb-5 h-9 w-9 text-emerald-700" />
          <h1 ref={resultRef} tabIndex={-1} className="text-2xl font-semibold">{copy('Your response is saved.', 'Su respuesta se guardó.')}</h1>
          <p className="mt-4 leading-7">{copy('Bloomjoy will review your response and check the purchase details where possible. This is the same refund request; you do not need to submit another one.', 'Bloomjoy revisará su respuesta y verificará los detalles de compra cuando sea posible. Es la misma solicitud de reembolso; no necesita enviar otra.')}</p>
          <p className="mt-4 text-sm text-muted-foreground">{copy('We’ll email you about the next step. Saving these details does not approve or confirm a refund.', 'Le enviaremos un correo sobre el siguiente paso. Guardar estos detalles no aprueba ni confirma un reembolso.')}</p>
          <p className="mt-6 font-medium">{context?.publicReference}</p>
        </section> : !context || context.state !== 'ready' || (!token && !demo) ? <section>
          <h1 className="text-2xl font-semibold">This link is no longer available.</h1>
          <p className="mt-4 leading-7">Reply to your Bloomjoy refund email for help with your existing request. You do not need to start again.</p>
          <p className="mt-4 leading-7" lang="es">Este enlace ya no está disponible. Responda al correo de reembolso de Bloomjoy para obtener ayuda con su solicitud. No necesita comenzar de nuevo.</p>
        </section> : <>
          <p className="text-sm font-medium text-muted-foreground">{context.publicReference}</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{copy('Update your refund request', 'Actualice su solicitud de reembolso')}</h1>
          <p className="mt-4 leading-7">{copy('Check the details below so we can review the right purchase. Confirm what is correct, change what needs fixing, or tell us you’re not sure.', 'Revise los detalles para que podamos encontrar la compra correcta. Confirme lo correcto, corrija lo necesario o indique que no está seguro.')}</p>
          <p className="mt-4 flex gap-2 text-sm leading-6 text-muted-foreground"><ShieldCheck aria-hidden className="mt-1 h-4 w-4 shrink-0" />{copy('Only the last four card digits. Never share a full card number, security code, password or screenshot.', 'Solo los últimos cuatro dígitos. Nunca comparta el número completo de tarjeta, código de seguridad, contraseña ni captura de pantalla.')}</p>
          <form onSubmit={submit} className="mt-8 space-y-7" noValidate>
            {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive p-4 text-sm">{error}</div>}
            {fields.map((field) => {
              const answer = answers[field];
              const isRequested = requested.includes(field);
              const label = correctionLabels[field];
              const choices = field === 'location_or_machine' ? context.locationChoices?.map(({key,label}) => [key,label,label] as [string,string,string]) : correctionChoices[field];
              const fieldValue = answer?.disposition === 'changed' ? answer.value ?? '' : values[field] ?? '';
              const inputId = `correction-${field}`;
              return <fieldset key={field} className="space-y-3 border-t border-border pt-5">
                <legend className="pr-3 text-base font-semibold">{copy(...label)} {isRequested && <span className="text-sm font-normal text-muted-foreground">({copy('Please check', 'Por favor revise')})</span>}</legend>
                {field === 'card_last4' && <p id={`${inputId}-help`} className="text-sm leading-6 text-muted-foreground">{wallet ? copy('Use the last four digits of the wallet or device card used for this purchase. They may differ from your physical card.', 'Use los últimos cuatro dígitos de la tarjeta de su billetera o dispositivo. Pueden ser distintos de la tarjeta física.') : copy('Use the last four digits of the physical card you used.', 'Use los últimos cuatro dígitos de la tarjeta física que usó.')}</p>}
                {field === 'incident_time' && <p id={`${inputId}-help`} className="text-sm text-muted-foreground">{copy('Use the local time at the purchase location. An estimate is okay.', 'Use la hora local del lugar de compra. Una estimación está bien.')}</p>}
                <label htmlFor={`${inputId}-answer`} className="sr-only">{copy('Your answer', 'Su respuesta')}: {copy(...label)}</label>
                <select id={`${inputId}-answer`} className={controlClass} value={answer?.disposition ?? ''}
                  onChange={(event) => update(field, event.target.value === 'changed' ? { disposition: 'changed', value: field === 'location_or_machine' ? '' : values[field] ?? '', ...(field === 'incident_time' ? { confidence: 'rough' as const } : {}) } : { disposition: event.target.value as CorrectionAnswer['disposition'] })}>
                  <option value="">{copy('Choose an answer', 'Elija una respuesta')}</option>
                  <option value="changed">{copy(values[field] ? 'Change this detail' : 'Add this detail', values[field] ? 'Corregir este detalle' : 'Agregar este detalle')}</option>
                  {values[field] && <option value="confirmed">{copy('This is correct', 'Esto es correcto')}</option>}
                  <option value="cannot_provide">{copy('I’m not sure / I can’t provide this', 'No estoy seguro / No puedo proporcionar esto')}</option>
                </select>
                {answer?.disposition === 'changed' ? <>
                  <label htmlFor={inputId} className="sr-only">{copy(...label)}</label>
                  {choices ? <select id={inputId} className={controlClass} value={fieldValue} onChange={(event) => update(field, { disposition: 'changed', value: event.target.value })}>
                    <option value="">{copy('Choose one', 'Elija una opción')}</option>
                    {choices.map(([key, en, sp]) => <option key={key} value={key}>{copy(en, sp)}</option>)}
                  </select> : <Input id={inputId} className="min-h-11" aria-describedby={['card_last4','incident_time'].includes(field) ? `${inputId}-help` : undefined}
                    type={field === 'incident_date' ? 'date' : field === 'incident_time' ? 'time' : 'text'}
                    inputMode={field === 'card_last4' ? 'numeric' : field === 'amount' ? 'decimal' : undefined}
                    maxLength={field === 'card_last4' ? 4 : 160} autoComplete="off" value={fieldValue}
                    onChange={(event) => update(field, { disposition: 'changed', value: event.target.value, ...(field === 'incident_time' ? { confidence: answer.confidence ?? 'rough' } : {}) })} />}
                  {field === 'incident_time' && <>
                    <label htmlFor={`${inputId}-confidence`} className="block text-sm font-medium">{copy('How close is that time?', '¿Qué tan precisa es esa hora?')}</label>
                    <select id={`${inputId}-confidence`} className={controlClass} value={answer.confidence ?? 'rough'} onChange={(event) => update(field, { ...answer, confidence: event.target.value as CorrectionAnswer['confidence'] })}>
                      <option value="rough">{copy('A rough estimate', 'Una estimación aproximada')}</option>
                      <option value="within_1_hour">{copy('Within about an hour', 'Dentro de una hora aproximadamente')}</option>
                      <option value="within_15_minutes">{copy('Within about 15 minutes', 'Dentro de unos 15 minutos')}</option>
                      <option value="exact">{copy('Exact time from the purchase record', 'Hora exacta del registro de compra')}</option>
                    </select>
                  </>}
                </> : values[field] && <p className="text-sm">{copy('You previously shared', 'Antes indicó')}: <strong>{choices?.find(([key]) => key === values[field])?.[es ? 2 : 1] ?? values[field]}</strong></p>}
              </fieldset>;
            })}
            <Button type="button" variant="ghost" className="h-auto whitespace-normal px-0 text-left" onClick={() => setReviewOthers(!reviewOthers)} aria-expanded={reviewOthers}>{copy(reviewOthers ? 'Show only requested details' : 'Review other purchase details', reviewOthers ? 'Mostrar solo los detalles solicitados' : 'Revisar otros detalles de compra')}</Button>
            <Button type="submit" className="min-h-12 w-full whitespace-normal" disabled={saving}>{copy(saving ? 'Saving…' : 'Save my response', saving ? 'Guardando…' : 'Guardar mi respuesta')}</Button>
            <p className="text-sm leading-6 text-muted-foreground">{copy('Need help? Reply to your Bloomjoy refund email. Your request stays open while we review your response.', '¿Necesita ayuda? Responda al correo de reembolso de Bloomjoy. Su solicitud permanece abierta mientras revisamos su respuesta.')}</p>
          </form>
        </>}
    </div>
  </main>;
}
