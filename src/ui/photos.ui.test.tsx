import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_START, setMenuState, setStartingMenu } from '../domain/menu.ts';
import { EMPTY_MENU_STATE } from '../domain/menuEdits.ts';
import { FAKE_RICE_START } from '../fake/data.ts';
import { photoTools } from '../services/photos.ts';
import { readAll } from './eventLog.ts';
import { Root } from './Root.tsx';

// jsdom draws nothing: "made small" is the picture as it came, marked WebP.
const shrink = photoTools.shrink;
beforeEach(() => {
  localStorage.clear(); history.replaceState(null, '', '/'); setMenuState(EMPTY_MENU_STATE);
  photoTools.shrink = async (b: Blob) => new Blob([await b.arrayBuffer()], { type: 'image/webp' });
});
afterEach(() => { cleanup(); setMenuState(EMPTY_MENU_STATE); setStartingMenu(SAMPLE_START); photoTools.shrink = shrink; });

const picture = (bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], 'kottu.jpg', { type: 'image/jpeg' });
const photoEvents = () => readAll().filter((e) => e.type === 'menu.photo_set');
const strips = () => document.querySelectorAll('.card__photo');
const pictures = () => document.querySelectorAll('.card__photo img');

const openMenu = () => {
  history.replaceState(null, '', '/#menu');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

test('a shop with no photos keeps its tiles as they were; the owner gives an item a photo from a file: every tile gets a strip, blank where none; Undo', async () => {
  const user = userEvent.setup();
  render(<Root />);
  expect(strips()).toHaveLength(0);

  openMenu();
  await user.click(await screen.findByRole('button', { name: 'Change Margherita' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Change Margherita' }));
  expect(sheet.getByText(/No photo/)).toBeTruthy();
  await user.upload(sheet.getByLabelText('Photo file'), picture());
  expect(await sheet.findByRole('img', { name: 'Photo of Margherita' })).toBeTruthy();
  expect(sheet.getByRole('status').textContent).toContain('Photo changed.');
  const [set] = photoEvents();
  expect(set).toMatchObject({ itemId: 'margherita', photo: expect.stringMatching(/^[a-f0-9]{64}$/) });

  await user.keyboard('{Escape}');
  await user.keyboard('{Escape}');
  expect(strips().length).toBeGreaterThan(1);
  expect(pictures()).toHaveLength(1); // the others are blank strips

  // Undo: back to the photo it had (none), so the tiles lose their strips again.
  openMenu();
  await user.click(await screen.findByRole('button', { name: 'Change Margherita' }));
  const again = within(screen.getByRole('dialog', { name: 'Change Margherita' }));
  await user.click(again.getByRole('button', { name: 'Remove photo' }));
  expect(photoEvents().at(-1)).toMatchObject({ itemId: 'margherita', photo: null });
  expect(again.getByText(/No photo/)).toBeTruthy();
  await user.click(again.getByRole('button', { name: 'Undo' }));
  expect(photoEvents().at(-1)).toMatchObject({ photo: set.photo });
  expect(again.getByRole('img', { name: 'Photo of Margherita' })).toBeTruthy();
});

test('a picture pasted with Ctrl+V on the sheet becomes the photo; pasted text still goes into the field', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  await user.click(await screen.findByRole('button', { name: 'Change Margherita' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Change Margherita' }));
  const paste = (files: File[]) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files } });
    fireEvent(window, e);
    return e;
  };
  expect(paste([]).defaultPrevented).toBe(false); // text: left alone
  expect(photoEvents()).toHaveLength(0);
  expect(paste([picture([9, 9])]).defaultPrevented).toBe(true);
  expect(await sheet.findByRole('img', { name: 'Photo of Margherita' })).toBeTruthy();
  expect(photoEvents()).toHaveLength(1);
});

test('a new item gets its photo with it; Bata Kade starts with its own photos, and the owner can take one off', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  await user.click(await screen.findByRole('button', { name: 'Pasta' }));
  await user.click(screen.getByRole('button', { name: '+ Add to Pasta' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Add to Pasta' }));
  await user.type(sheet.getByLabelText('Name'), 'Chicken Alfredo');
  await user.upload(sheet.getByLabelText('Photo file'), picture());
  expect(await sheet.findByRole('img', { name: 'Photo of Chicken Alfredo' })).toBeTruthy();
  expect(photoEvents()).toHaveLength(0); // not until it is added
  await user.type(sheet.getByLabelText('Single price'), '1100{Enter}');
  expect(photoEvents()).toMatchObject([{ itemId: 'new-chicken-alfredo', photo: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  expect(sheet.getByText(/No photo/)).toBeTruthy(); // ready for the next one
  cleanup();

  // The rice demo: Bata Kade's starting photos, blanks for the rest.
  setStartingMenu(FAKE_RICE_START);
  history.replaceState(null, '', '/');
  render(<Root />);
  await user.click(screen.getByRole('button', { name: 'Meals' }));
  const wade = screen.getByText('Parippu Wade').closest('.card') as HTMLElement;
  expect(wade.querySelector('.card__photo img')).toBeTruthy();
  // A photo pasted on the demo (WebP), and a blank where the menu has none.
  expect((screen.getByText('Vegetable Roti').closest('.card') as HTMLElement).querySelector('.card__photo img')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Other' }));
  const yoghurt = screen.getByText('Yoghurt').closest('.card') as HTMLElement;
  expect(yoghurt.querySelector('.card__photo')).toBeTruthy();
  expect(yoghurt.querySelector('.card__photo img')).toBeNull();
});
