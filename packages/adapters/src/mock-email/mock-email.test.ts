import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../interfaces/index.js';
import type { EmailMessage } from '../interfaces/index.js';
import {
  MAX_EMAIL_NAME,
  MAX_IDEMPOTENCY_KEY,
  MAX_REMEMBERED_MESSAGES,
  createMockEmailSender,
  factory,
} from './index.js';

const MSG: EmailMessage = {
  to: [{ address: 'info@pizzeria.example' }],
  replyTo: { address: 'anna@visitor.example', name: 'Anna Andersson' },
  subject: 'Ny förfrågan: Anna Andersson',
  text: 'Hej, jag vill boka bord för 8 personer.',
  locale: 'sv',
  idempotencyKey: 'submission-1',
  tags: ['contact'],
};

const FROM = '"Pizzeria Exempel" <no-reply@pizzeria.example>';

function make() {
  const logs: unknown[] = [];
  const sender = createMockEmailSender({ from: FROM, logger: { info: (e) => logs.push(e) } });
  return { sender, logs };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AdapterError);
    return (e as AdapterError).code;
  }
  return 'none';
}

describe('mock-email', () => {
  it('records the message in the outbox and returns a message id', async () => {
    const { sender } = make();
    const res = await sender.send(MSG);
    expect(res.messageId).toMatch(/^mock-/);
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]).toMatchObject({ messageId: res.messageId, from: FROM, message: MSG });
  });

  it('is idempotent per idempotencyKey', async () => {
    const { sender } = make();
    const a = await sender.send(MSG);
    const b = await sender.send({ ...MSG, text: 'retry' });
    expect(b.messageId).toBe(a.messageId);
    expect(sender.outbox).toHaveLength(1);
    const c = await sender.send({ ...MSG, idempotencyKey: 'submission-2' });
    expect(c.messageId).not.toBe(a.messageId);
  });

  it('logs only messageId, tags and locale, never PII', async () => {
    const { sender, logs } = make();
    const res = await sender.send(MSG);
    expect(logs).toEqual([{ messageId: res.messageId, tags: ['contact'], locale: 'sv' }]);
    const text = JSON.stringify(logs);
    for (const pii of ['info@pizzeria', 'anna@visitor', 'Anna', 'boka bord', 'förfrågan']) {
      expect(text).not.toContain(pii);
    }
  });

  it('default logger prints no PII and makes no network call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sender = createMockEmailSender({ from: FROM });
    await sender.send(MSG);
    const printed = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(printed).not.toContain('anna@visitor');
    expect(printed).not.toContain('Anna');
    expect(printed).not.toContain('boka bord');
    expect(fetchSpy).not.toHaveBeenCalled();
    warn.mockRestore();
    fetchSpy.mockRestore();
  });

  it('rejects CR/LF in any address (header injection)', async () => {
    const { sender, logs } = make();
    for (const address of [
      'a@b.example\r\nBcc: evil@x.example',
      'a@b.example\nBcc: evil@x.example',
      'a@b.example\r',
      'a\n@b.example',
    ]) {
      expect(await code(sender.send({ ...MSG, to: [{ address }] }))).toBe('invalid_input');
      expect(await code(sender.send({ ...MSG, replyTo: { address } }))).toBe('invalid_input');
    }
    expect(sender.outbox).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it('error messages never echo PII', async () => {
    const { sender } = make();
    try {
      await sender.send({
        ...MSG,
        to: [{ address: 'secret.person@x.example\r\nBcc: y@z.example' }],
      });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret.person');
      return;
    }
    throw new Error('expected rejection');
  });

  it('rejects other malformed addresses', async () => {
    const { sender } = make();
    for (const address of [
      '',
      'no-at-sign',
      'a b@c.example',
      'a@b@c.example',
      '<a@b.example>',
      'a@b.example,c@d.example',
    ]) {
      expect(await code(sender.send({ ...MSG, to: [{ address }] }))).toBe('invalid_input');
    }
  });

  it('enforces the contract limits', async () => {
    const { sender } = make();
    const a = { address: 'a@b.example' };
    expect(await code(sender.send({ ...MSG, subject: 'x\ny' }))).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, subject: 'x'.repeat(201) }))).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, subject: '' }))).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, text: 'x'.repeat(20_001) }))).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBe(
      'invalid_input',
    );
    expect(await code(sender.send({ ...MSG, tags: ['Bad Tag'] }))).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, idempotencyKey: '' }))).toBe('invalid_input');
    expect(
      await code(sender.send({ ...MSG, to: Array(11).fill(a) as unknown as EmailMessage['to'] })),
    ).toBe('invalid_input');
    expect(await code(sender.send({ ...MSG, to: [] as unknown as EmailMessage['to'] }))).toBe(
      'invalid_input',
    );
    expect(
      await code(sender.send({ ...MSG, to: Array(10).fill(a) as unknown as EmailMessage['to'] })),
    ).toBe('none');
  });

  it('rejects CR/LF in a display name (header injection, #100)', async () => {
    const { sender } = make();
    for (const name of ['Anna\r\nBcc: evil@attacker.example', 'Anna\nX', 'Anna\rX']) {
      const replyTo = { address: 'anna@visitor.example', name };
      await expect(sender.send({ ...MSG, replyTo })).rejects.toMatchObject({
        code: 'invalid_input',
        message: expect.stringContaining('name contains CR/LF') as string,
      });
      await expect(
        sender.send({ ...MSG, to: [{ address: 'info@pizzeria.example', name }] }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(sender.outbox).toHaveLength(0);
  });

  it('rejects other control characters and an over-long display name (#100)', async () => {
    const { sender } = make();
    const reject = async (name: string): Promise<void> => {
      const replyTo = { address: 'anna@visitor.example', name };
      expect(await code(sender.send({ ...MSG, replyTo }))).toBe('invalid_input');
    };
    await reject('Anna\u0000');
    await reject('Anna\tAndersson');
    await reject('Anna\u007f');
    await reject('a'.repeat(MAX_EMAIL_NAME + 1));
    const ok = { address: 'anna@visitor.example', name: 'å'.repeat(MAX_EMAIL_NAME) };
    expect(await code(sender.send({ ...MSG, replyTo: ok }))).toBe('none');
  });

  it('caps the idempotency key length (#100)', async () => {
    const { sender } = make();
    const long = 'k'.repeat(MAX_IDEMPOTENCY_KEY + 1);
    expect(await code(sender.send({ ...MSG, idempotencyKey: long }))).toBe('invalid_input');
    const max = 'k'.repeat(MAX_IDEMPOTENCY_KEY);
    expect(await code(sender.send({ ...MSG, idempotencyKey: max }))).toBe('none');
  });

  it('remembers at most MAX_REMEMBERED_MESSAGES keys, forgetting the oldest (#100)', async () => {
    const { sender } = make();
    for (let i = 0; i <= MAX_REMEMBERED_MESSAGES; i++) {
      await sender.send({ ...MSG, idempotencyKey: `k-${String(i)}` });
    }
    expect(sender.outbox).toHaveLength(MAX_REMEMBERED_MESSAGES);
    expect(sender.outbox[0]?.message.idempotencyKey).toBe('k-1');
    // The newest key is still de-duplicated; the forgotten oldest one is sent again.
    const newest = sender.outbox[MAX_REMEMBERED_MESSAGES - 1]?.messageId;
    const again = await sender.send({
      ...MSG,
      idempotencyKey: `k-${String(MAX_REMEMBERED_MESSAGES)}`,
    });
    expect(again.messageId).toBe(newest);
    expect(sender.outbox).toHaveLength(MAX_REMEMBERED_MESSAGES);
  });

  it('factory requires EMAIL_FROM without CR/LF', () => {
    expect(factory.name).toBe('mock-email');
    expect(factory.env).toEqual([expect.objectContaining({ name: 'EMAIL_FROM', required: true })]);
    expect(factory.create({ EMAIL_FROM: FROM }).name).toBe('mock-email');
    for (const env of [{}, { EMAIL_FROM: '' }, { EMAIL_FROM: 'a@b.example\r\nBcc: c@d.example' }]) {
      expect(() => factory.create(env)).toThrowError(
        expect.objectContaining({ code: 'misconfigured' }) as Error,
      );
    }
  });
});
