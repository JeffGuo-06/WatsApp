const COURSE_LINE_REGEX = /^([A-Z]{2,4})\s*(\d{3}[A-Z]?)\s*-\s+/;

export interface QuestParserOptions {
  knownCourses?: Set<string> | null;
}

export function parseQuestSchedule(
  input: string,
  options: QuestParserOptions = {}
): string[] {
  if (!input.trim()) {
    return [];
  }

  const normalized = input.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const discovered = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.toUpperCase().match(COURSE_LINE_REGEX);
    if (!match) continue;

    const subject = match[1];
    const catalog = match[2];
    const courseCode = `${subject} ${catalog}`.trim();

    discovered.add(courseCode);
  }

  const { knownCourses } = options;

  if (knownCourses && knownCourses.size > 0) {
    return Array.from(discovered).filter((code) => knownCourses.has(code));
  }

  return Array.from(discovered);
}

