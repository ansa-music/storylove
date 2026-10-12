import { Link } from 'react-router';

import { Reveal } from '@/components/Reveal';
import { useSiteData } from '@/features/site/SiteDataProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Что студия превращает в фильм — из описания студии (aboutText по умолчанию).
const STORY_MOMENTS = [
  { title: 'История знакомства', text: 'Тот самый день, с которого всё началось.' },
  { title: 'Первое свидание', text: 'Место, слова и волнение первой встречи вдвоём.' },
  { title: 'Предложение', text: 'Минута, когда прозвучало главное «да».' },
  { title: 'Свадьба', text: 'День, который хочется пережить ещё раз.' },
] as const;

export function AboutPage() {
  const { settings } = useSiteData();
  useDocumentTitle(`О студии — ${settings.studioName}`);

  return (
    <>
      <section
        aria-labelledby="about-title"
        className="relative isolate overflow-hidden pt-[clamp(8rem,16vw,12rem)] pb-[clamp(4rem,9vw,7rem)]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_70%_at_85%_0%,rgb(74_29_49/0.7),transparent_70%)]"
        />
        <div className="shell grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="animate-fade-up lg:col-span-7">
            {settings.aboutEyebrow && <p className="label text-gold">{settings.aboutEyebrow}</p>}
            <h1 id="about-title" className="mt-5 text-[clamp(2.5rem,5.6vw,5.25rem)] text-pearl">
              {settings.aboutTitle}
            </h1>
          </div>
          <div className="animate-fade-up [animation-delay:150ms] lg:col-span-5 lg:pt-16">
            <div className="hairline mb-8 w-24" />
            <p className="text-[clamp(1.05rem,1.25vw,1.25rem)] leading-relaxed text-ink-100">
              {settings.aboutText}
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="about-create-title"
        className="border-t border-pearl/5 py-[clamp(4rem,9vw,7rem)]"
      >
        <div className="shell">
          <Reveal>
            <p className="label text-rose-soft">Что мы создаём</p>
            <h2 id="about-create-title" className="mt-5 max-w-3xl text-[clamp(2rem,4vw,3.75rem)] text-pearl">
              Фильм о главных моментах вашей пары
            </h2>
          </Reveal>
          <ol className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-x-12 sm:grid-cols-2">
            {STORY_MOMENTS.map((moment, index) => (
              <li key={moment.title} className="border-t border-pearl/10 py-8">
                <Reveal delay={(index % 2) * 0.1} className="flex gap-6">
                  <span aria-hidden="true" className="label pt-2 text-gold/70">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-[clamp(1.6rem,2.4vw,2.2rem)] text-pearl">{moment.title}</h3>
                    <p className="mt-3 text-ink-200">{moment.text}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="about-films-title"
        className="relative isolate overflow-hidden bg-wine-deep py-[clamp(4.5rem,10vw,8rem)] text-center"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_90%_at_50%_100%,var(--color-wine-bright),transparent_70%)]"
        />
        <Reveal className="shell flex flex-col items-center">
          <h2 id="about-films-title" className="max-w-3xl text-[clamp(2rem,4.4vw,4rem)] text-pearl">
            {settings.tiersTitle}
          </h2>
          {settings.compareIntro && (
            <p className="mt-6 max-w-xl text-lg text-pearl/85">{settings.compareIntro}</p>
          )}
          <Link to={{ pathname: '/', hash: '#films' }} className="btn btn-gold mt-10">
            {settings.heroPrimaryCta}
          </Link>
        </Reveal>
      </section>
    </>
  );
}
