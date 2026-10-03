import { expect, test } from '@playwright/test';
import { openApp } from './flow.js';

test('FAQPage structured data repeats the visible FAQ word for word', async ({ page }) => {
  await openApp(page);
  const visible = await page.locator('.faq-item').evaluateAll((items) =>
    items.map((item) => [item.querySelector('h3')?.textContent ?? '', item.querySelector('p')?.textContent ?? '']),
  );
  const structured = await page.locator('script[type="application/ld+json"]').evaluate((script) => {
    /** @type {{ '@type': string, mainEntity?: { name: string, acceptedAnswer: { text: string } }[] }[]} */
    const graph = JSON.parse(script.textContent ?? '{}')['@graph'];
    const faq = graph.find((node) => node['@type'] === 'FAQPage');
    return (faq?.mainEntity ?? []).map((entry) => [entry.name, entry.acceptedAnswer.text]);
  });
  expect(visible).toHaveLength(7);
  expect(structured).toEqual(visible);
});
