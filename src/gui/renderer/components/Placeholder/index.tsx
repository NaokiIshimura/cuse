interface PlaceholderProps {
  readonly title: string;
  readonly stage: string;
  readonly description: string;
}

/** 後の段階で入る場所。今は何もしないことが分かるよう、入る時期と中身だけを書く。 */
export const Placeholder = ({ title, stage, description }: PlaceholderProps) => (
  <section className="placeholder" aria-label={title}>
    <header className="pane-header">
      <span className="pane-header__title">{title}</span>
    </header>
    <div className="placeholder__body">
      <p className="placeholder__stage">{stage}</p>
      <p className="placeholder__description">{description}</p>
    </div>
  </section>
);
