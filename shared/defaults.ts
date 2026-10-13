// Тексты по умолчанию. В базе хранятся только изменённые значения;
// эти же тексты клиент показывает, пока ответ API не пришёл.

import type { SiteSettings } from './api.ts';
import { DEFAULT_STORAGE_BUDGET_GB, type TierSlug } from './constants.ts';

export const DEFAULT_SETTINGS: SiteSettings = {
  studioName: 'STORYLOVE',
  logoTagline: 'AI CINEMATIC LOVE STORIES',
  heroEyebrow: 'STORYLOVE — AI ANIMATION STUDIO',
  heroTitle: 'Ваша история любви достойна большого кино',
  heroSubtitle: 'Персональные анимационные фильмы по вашей истории.',
  heroPrimaryCta: 'Смотреть мультфильмы',
  heroSecondaryCta: 'О студии',
  aboutEyebrow: 'О студии',
  aboutTitle: 'Персональное кино, созданное из вашей истории',
  aboutText:
    'STORYLOVE — студия персональной AI-анимации. По вашим фотографиям и рассказу мы создаём анимационный фильм о знакомстве, первом свидании, предложении или свадьбе. Искусственный интеллект соединяется с творческой режиссурой, и история пары становится фильмом.',
  //   — неразрывные пробелы: на узком экране перенос не разорвёт «он и она» и «в историю».
  photosText: 'Нам нужно всего два фото — он и она. Мы превратим их в историю.',
  photoHimLabel: 'он',
  photoHerLabel: 'она',
  tiersEyebrow: 'Одна история — четыре формата',
  tiersTitle: 'Нажмите на формат — и смотрите пример',
  ultimaEyebrow: 'SIGNATURE CINEMATIC EXPERIENCE',
  ultimaTitle: 'Не просто мультфильм. Ваше личное кино',
  ultimaDescription: 'Для истории любви, которую хочется сохранить навсегда.',
  compareTitle: 'Сравните четыре уровня',
  compareIntro:
    'Каждый уровень — настоящий пример нашей работы. Откройте их по очереди и выберите тот, который ближе вашей истории.',
  finalTitle: 'Ваша история заслуживает лучшего кадра',
  finalText: 'Начните с флагманского уровня — и вернитесь к остальным, чтобы сравнить.',
  finalCta: 'Смотреть УЛЬТИМА',
  footerText: 'STORYLOVE — студия персональной AI-анимации.',
  footerNote: 'Все мультфильмы на сайте — примеры работ студии.',
  metaTitle: 'STORYLOVE — AI-мультфильмы по вашей истории любви',
  metaDescription:
    'STORYLOVE создаёт персональные анимационные Love Story. Смотрите примеры четырёх уровней: Эконом, Базовый, Премиум и Ультима.',
  siteVisible: true,
  storageBudgetGb: DEFAULT_STORAGE_BUDGET_GB,
};

export interface FilmDefaults {
  slug: TierSlug;
  tierOrder: number;
  title: string;
  tagline: string;
  description: string;
  compareText: string;
  buttonLabel: string;
}

// Описания нейтральные: характеристики уровней ещё не утверждены,
// поэтому здесь нет ни цен, ни сроков, ни технических обещаний.
export const DEFAULT_FILMS: readonly FilmDefaults[] = [
  {
    slug: 'econom',
    tierOrder: 1,
    title: 'ЭКОНОМ',
    tagline: 'Простое начало вашей истории',
    description: 'Пример мультфильма уровня ЭКОНОМ. Посмотрите его целиком и сравните с остальными уровнями.',
    compareText: 'Начальный уровень исполнения.',
    buttonLabel: 'Смотреть пример',
  },
  {
    slug: 'basic',
    tierOrder: 2,
    title: 'БАЗОВЫЙ',
    tagline: 'Когда воспоминания обретают форму',
    description:
      'Пример мультфильма уровня БАЗОВЫЙ. Посмотрите его целиком и сравните с остальными уровнями.',
    compareText: 'Следующий шаг в проработке истории.',
    buttonLabel: 'Смотреть пример',
  },
  {
    slug: 'premium',
    tierOrder: 3,
    title: 'ПРЕМИУМ',
    tagline: 'Каждая деталь превращается в искусство',
    description:
      'Пример мультфильма уровня ПРЕМИУМ. Посмотрите его целиком и сравните с остальными уровнями.',
    compareText: 'Высокий уровень художественной проработки.',
    buttonLabel: 'Смотреть ПРЕМИУМ',
  },
  {
    slug: 'ultima',
    tierOrder: 4,
    title: 'УЛЬТИМА',
    tagline: 'Не просто мультфильм. Ваше личное кино',
    description:
      'Пример мультфильма флагманского уровня УЛЬТИМА. Посмотрите его целиком и сравните с остальными уровнями.',
    compareText: 'Флагманский уровень студии.',
    buttonLabel: 'Смотреть УЛЬТИМА',
  },
];

export const TEXT_LIMITS = {
  title: 80,
  tagline: 160,
  description: 2000,
  compareText: 400,
  buttonLabel: 40,
  settingShort: 200,
  settingLong: 2000,
} as const;
