import { describe, expect, it } from 'vitest';
import { codeBlockBody, renderInlineHtml } from './markdown';

const MENTIONS = { user: '@member', role: '@role', channel: '#channel' };

describe('blocs de code', () => {
  it('retire la langue d\'un bloc ```json', () => {
    const html = renderInlineHtml('```json\n{ "a": 1 }```', MENTIONS);
    expect(html).toContain('<pre>{ &quot;a&quot;: 1 }</pre>');
    expect(html).not.toContain('json');
  });
  it('accepte les identifiants à symboles (c++, c#, objective-c)', () => {
    expect(codeBlockBody('c++\nint x;')).toBe('int x;');
    expect(codeBlockBody('c#\nvar x;')).toBe('var x;');
    expect(codeBlockBody('objective-c\n@end')).toBe('@end');
  });
  it('garde le mot quand il n\'y a pas de saut de ligne', () => {
    expect(codeBlockBody('json')).toBe('json');
    expect(renderInlineHtml('```json```', MENTIONS)).toContain('<pre>json</pre>');
  });
  it('garde une première ligne qui n\'est pas un mot seul', () => {
    expect(codeBlockBody('const x = 1;\nx++')).toBe('const x = 1;\nx++');
    expect(codeBlockBody('\nfoo')).toBe('\nfoo');
  });
  it('contrôle positif : sans langue, le bloc est rendu tel quel', () => {
    expect(renderInlineHtml('```\nline 1\nline 2```', MENTIONS)).toContain('<pre>line 1\nline 2</pre>');
  });
});
