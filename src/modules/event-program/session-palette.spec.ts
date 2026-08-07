import { sessionTypeEnum } from '../../db/schema';
import { colourForType } from './session-palette';

describe('Session palette (US-PROG-01, US-PROG-03)', () => {
  it('gives every session type a colour', () => {
    // A type with no colour would render as an uncoloured block, so the map
    // has to stay exhaustive as types are added.
    for (const type of sessionTypeEnum.enumValues) {
      expect(colourForType(type)).toBeTruthy();
    }
  });

  it('uses the documented palette', () => {
    expect(colourForType('Keynote')).toBe('blue');
    expect(colourForType('Panel')).toBe('green');
  });

  it('gives the same type the same colour every time', () => {
    // The whole point of US-PROG-01: two Keynotes must never differ.
    expect(colourForType('Keynote')).toBe(colourForType('Keynote'));
  });

  it('gives different types different colours', () => {
    const seen = sessionTypeEnum.enumValues.map(colourForType);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
