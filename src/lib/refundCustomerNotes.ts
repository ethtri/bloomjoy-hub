export type CustomerNoteMessage = {
  id: string; direction: string; kind: string; participantRole: string; participantTrust: string;
  body: string; receivedAt: string; contentDeleted: boolean;
};

export function latestVerifiedCustomerNote(messages: readonly CustomerNoteMessage[] = []) {
  return messages.filter(message => message.direction === 'inbound' && message.kind === 'message'
    && message.participantRole === 'customer' && message.participantTrust === 'verified'
    && !message.contentDeleted && Boolean(message.body?.trim()) && Number.isFinite(Date.parse(message.receivedAt)))
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id.localeCompare(a.id))[0] ?? null;
}
