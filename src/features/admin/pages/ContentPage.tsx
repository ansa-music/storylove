import { Link } from 'react-router';

import type { AdminSettingsResponse } from '@shared/api';
import { DEFAULT_FILMS } from '@shared/defaults';

import { TextSettingsForm, type TextFieldGroup } from '../components/TextSettingsForm';
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { useAdminQuery } from '../lib/useAdminQuery';

const GROUPS: readonly TextFieldGroup[] = [
  {
    title: 'Первый экран (Hero)',
    description: 'То, что посетитель видит сразу после открытия сайта.',
    fields: [
      { key: 'heroEyebrow', label: 'Надзаголовок' },
      { key: 'heroTitle', label: 'Заголовок' },
      { key: 'heroSubtitle', label: 'Подзаголовок', long: true },
      { key: 'heroPrimaryCta', label: 'Главная кнопка' },
      { key: 'heroSecondaryCta', label: 'Вторая кнопка' },
    ],
  },
  {
    title: 'О студии',
    fields: [
      { key: 'aboutEyebrow', label: 'Надзаголовок' },
      { key: 'aboutTitle', label: 'Заголовок' },
      { key: 'aboutText', label: 'Текст', long: true },
    ],
  },
  {
    title: 'Блок уровней',
    fields: [
      { key: 'tiersEyebrow', label: 'Надзаголовок' },
      { key: 'tiersTitle', label: 'Заголовок' },
    ],
  },
  {
    title: 'УЛЬТИМА',
    description: 'Отдельный блок флагманского уровня на главной странице.',
    fields: [
      { key: 'ultimaEyebrow', label: 'Надзаголовок' },
      { key: 'ultimaTitle', label: 'Заголовок' },
      { key: 'ultimaDescription', label: 'Описание', long: true },
    ],
  },
  {
    title: 'Сравнение',
    fields: [
      { key: 'compareTitle', label: 'Заголовок' },
      { key: 'compareIntro', label: 'Вступление', long: true },
    ],
  },
  {
    title: 'Финальный экран',
    fields: [
      { key: 'finalTitle', label: 'Заголовок' },
      { key: 'finalText', label: 'Текст', long: true },
      { key: 'finalCta', label: 'Кнопка' },
    ],
  },
  {
    title: 'Футер',
    fields: [
      { key: 'footerText', label: 'Основной текст', long: true },
      { key: 'footerNote', label: 'Примечание', long: true },
    ],
  },
];

export function ContentPage() {
  const { data, error, loading, reload, setData } = useAdminQuery<AdminSettingsResponse>('/api/admin/settings');

  return (
    <>
      <PageHeader
        title="Тексты"
        description="Тексты главной страницы. Сохраняются только изменённые поля; любое поле можно вернуть к стандартному."
      />
      {!data && loading && <LoadingState label="Загружаем тексты…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <div className="mt-4 space-y-6">
          <Card
            title="Тексты четырёх уровней"
            description="Название, фраза, описание и надпись на кнопке каждого уровня редактируются на его странице."
          >
            <ul className="flex flex-wrap gap-2">
              {DEFAULT_FILMS.map((film) => (
                <li key={film.slug}>
                  <Link to={`/admin/films/${film.slug}`} className="btn btn-quiet btn-sm">
                    {film.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <TextSettingsForm settings={data.settings} groups={GROUPS} onSaved={setData} />
        </div>
      )}
    </>
  );
}
