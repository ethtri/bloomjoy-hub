export const ingestRefundGmailThreadBeforeFirstContact = async <
  Message,
  Candidate,
>({
  messages,
  ingestMessage,
  processFirstContact,
}: {
  messages: Message[];
  ingestMessage: (message: Message) => Promise<Candidate | null>;
  processFirstContact: (candidate: Candidate) => Promise<void>;
}) => {
  const candidates: Candidate[] = [];
  for (const message of messages) {
    const candidate = await ingestMessage(message);
    if (candidate) candidates.push(candidate);
  }
  if (candidates[0]) await processFirstContact(candidates[0]);
  return { candidateCount: candidates.length };
};
