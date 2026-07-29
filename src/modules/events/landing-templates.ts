import type { TemplateId } from './events.types';

/** A public landing-page template offered in the gallery (US-EVT-07). */
export interface LandingTemplate {
  id: TemplateId;
  title: string;
  badge: string;
  description: string;
}

/**
 * The four templates. `id` is the on-disk `template_id` enum value; `title` is the
 * gallery name shown to organizers. This is the single source seeded into the
 * global `landing_templates` lookup — don't re-type these values elsewhere.
 */
export const LANDING_TEMPLATES: readonly LandingTemplate[] = [
  {
    id: 'aurora',
    title: 'Classic',
    badge: 'Timeless',
    description: 'A clean, structured layout that suits any event.',
  },
  {
    id: 'noir',
    title: 'Spotlight',
    badge: 'Bold',
    description:
      'Dark, image-forward hero that puts the headline front and centre.',
  },
  {
    id: 'minimal',
    title: 'Minimal',
    badge: 'Understated',
    description: 'Typography-led and distraction-free.',
  },
  {
    id: 'atlas',
    title: 'Vibrant',
    badge: 'Colourful',
    description:
      'Playful colour and motion for festivals and community events.',
  },
];
