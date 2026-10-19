import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from '../src/supabase.js';
import { PersistenceError } from '../src/persistence.js';

const environment = (url: string) => ({
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: 'synthetic-public-key',
  SUPABASE_USER_EMAIL: 'bot@example.invalid',
  SUPABASE_USER_PASSWORD: 'synthetic-password',
});

describe('Supabase endpoint security', () => {
  it.each([
    'https://synthetic.supabase.co',
    'https://synthetic.supabase.co/',
    'https://proxy.example.invalid:8443/supabase',
    'http://localhost:54321',
    'http://LOCALHOST:54321/',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
    'http://localhost',
    'http://127.0.0.1',
    'http://[::1]',
  ])('accepts HTTPS or explicit local development endpoint %s', url => {
    expect(readSupabaseConfig(environment(url)).url).toBe(url);
  });

  it.each([
    'http://synthetic.supabase.co',
    'http://192.168.1.1:54321',
    'http://0.0.0.0:54321',
    'http://localhost.attacker.example',
    'http://attacker-localhost.example',
    'http://localhost.',
    'http://localhost%2e',
    'http://%6cocalhost',
    'http://127.0.0.1.attacker.example',
    'http://127.1',
    'http://127.000.000.001',
    'http://0177.0.0.1',
    'http://0x7f000001',
    'http://2130706433',
    'http://[0:0:0:0:0:0:0:1]',
    'http://[::ffff:127.0.0.1]',
    'http://localhost@attacker.example',
    'http://attacker.example@localhost',
    'http://@localhost',
    'https://user:synthetic-password@synthetic.supabase.co',
    'https://user@synthetic.supabase.co',
    'https://:synthetic-password@synthetic.supabase.co',
    'https://@synthetic.supabase.co',
    'http://localhost\\@attacker.example',
    ' https://synthetic.supabase.co',
    'https://synthetic.supabase.co ',
    'https://synthetic.\nsupabase.co',
    'https:synthetic.supabase.co',
    'http:/localhost',
    'http://localhost:65536',
    'ftp://localhost',
    'file:///localhost',
    '//localhost',
    'not-a-url',
    '',
  ])('rejects unsafe or ambiguous endpoint %s', url => {
    expect(() => readSupabaseConfig(environment(url))).toThrowError(new PersistenceError('configuration'));
  });

  it('reports only a safe configuration error, without credentials or URL', () => {
    const url = 'https://private-user:private-password@private.example.invalid';
    try {
      readSupabaseConfig(environment(url));
      expect.unreachable('Embedded credentials must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      expect((error as Error).message).toBe('Transaction persistence failed: configuration');
    }
  });
});
