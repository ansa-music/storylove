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
    ],
  },
  {
    title: 'Два фото и блок форматов',
    description:
      'Строка рядом с двумя фото и заголовок над четырьмя карточками. Сами фото загружаются в разделе «Настройки» → «Изображения сайта». Названия и фразы форматов — на их страницах.',
    fields: [
      {
        key: 'photosText',
        label: 'Строка о двух фото',
        hint: 'Если оставить поле пустым, строка и оба фото с сайта скрываются.',
      },
      { key: 'photoHimLabel', label: 'Подпись первого фото' },
      { key: 'photoHerLabel', label: 'Подпись второго фото' },
      { key: 'tiersEyebrow', label: 'Надзаголовок' },
      { key: 'tiersTitle', label: 'Заголовок' },
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
  const { data, error, loading, reload, setData } =
    useAdminQuery<AdminSettingsResponse>('/api/admin/settings');

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
