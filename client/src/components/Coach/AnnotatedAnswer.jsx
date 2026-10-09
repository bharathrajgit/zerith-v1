const annotationStyles = `
.coach-answer-annotation {
  position: relative;
  border-radius: 0.15rem;
  background: transparent;
  cursor: help;
  text-decoration-line: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.coach-answer-annotation--warning {
  color: #92400e;
  text-decoration-color: #f59e0b;
  background-color: #fef3c7;
}

.coach-answer-annotation--success {
  color: #065f46;
  text-decoration-color: #10b981;
  background-color: #d1fae5;
}

.coach-answer-annotation::after {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  width: max-content;
  max-width: min(20rem, 80vw);
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #0f172a;
  color: #fff;
  content: attr(data-note);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 0.25rem);
  transition: opacity 150ms ease, transform 150ms ease;
  white-space: normal;
}

.coach-answer-annotation:hover::after,
.coach-answer-annotation:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.coach-answer-annotation:focus-visible {
  outline: 2px solid #7c3aed;
  outline-offset: 3px;
}
`;

function getAnnotatedSegments(answer, annotations) {
  const matches = annotations
    .filter((annotation) =>
      annotation &&
      typeof annotation.quote === 'string' &&
      annotation.quote.length > 0 &&
      typeof annotation.note === 'string' &&
      ['warning', 'success'].includes(annotation.type)
    )
    .map((annotation, order) => ({
      ...annotation,
      order,
      start: answer.indexOf(annotation.quote),
    }))
    .filter((annotation) => annotation.start >= 0)
    .sort((a, b) => a.start - b.start || b.quote.length - a.quote.length || a.order - b.order);

  const segments = [];
  let cursor = 0;
  for (const annotation of matches) {
    if (annotation.start < cursor) continue;
    if (annotation.start > cursor) {
      segments.push({ text: answer.slice(cursor, annotation.start) });
    }
    segments.push({
      text: annotation.quote,
      annotation,
    });
    cursor = annotation.start + annotation.quote.length;
  }

  if (cursor < answer.length) {
    segments.push({ text: answer.slice(cursor) });
  }
  return segments;
}

export default function AnnotatedAnswer({ answer = '', annotations = [] }) {
  const safeAnswer = typeof answer === 'string' ? answer : '';
  const validAnnotations = Array.isArray(annotations) ? annotations : [];
  const hasMatchingAnnotation = validAnnotations.some((annotation) =>
    annotation &&
    typeof annotation.quote === 'string' &&
    annotation.quote.length > 0 &&
    safeAnswer.includes(annotation.quote) &&
    ['warning', 'success'].includes(annotation.type)
  );

  return (
    <section
      aria-label="Your answer with coach annotations"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Your answer</h2>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
        {!hasMatchingAnnotation
          ? safeAnswer
          : getAnnotatedSegments(safeAnswer, validAnnotations).map((segment, index) =>
              segment.annotation ? (
                <mark
                  key={`${segment.annotation.order}-${segment.annotation.start}`}
                  className={`coach-answer-annotation coach-answer-annotation--${segment.annotation.type}`}
                  data-note={segment.annotation.note}
                  title={segment.annotation.note}
                  tabIndex={0}
                  aria-label={`${segment.text}. ${segment.annotation.note}`}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={`answer-${index}`}>{segment.text}</span>
              )
            )}
      </p>
      {hasMatchingAnnotation && <style>{annotationStyles}</style>}
    </section>
  );
}
