/**
 * Делит строку на предложения. Нужно, чтобы на широком экране каждое предложение
 * начиналось с новой строки и перенос не рвал фразу посередине («он и / она»).
 * Без lookbehind в регулярном выражении: его не понимает Safari до 16.4.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*/g) ?? [text];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}
