import type { Task, TaskSection, Subtask } from '@/lib/types';

export function taskSectionId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseTaskMarkdown(content: string): { sections: TaskSection[]; tasks: Record<string, Task[]> } {
  const resultSections: TaskSection[] = [];
  const resultTasks: Record<string, Task[]> = {};
  let currentSectionId: string | null = null;
  let currentTask: Task | null = null;

  const lines = content.split('\n');

  for (const line of lines) {
    const headerMatch = line.match(/^## \*{0,2}(.+?)\*{0,2}$/);
    if (headerMatch) {
      if (currentTask && currentSectionId) {
        resultTasks[currentSectionId].push(currentTask);
        currentTask = null;
      }
      const sectionName = headerMatch[1].trim();
      currentSectionId = taskSectionId(sectionName);
      if (!resultTasks[currentSectionId]) {
        resultSections.push({ id: currentSectionId, name: sectionName });
        resultTasks[currentSectionId] = [];
      }
    } else if (currentSectionId && line.match(/^- \[[ xX]\]/)) {
      if (currentTask) {
        resultTasks[currentSectionId].push(currentTask);
      }
      const checked = line.match(/\[[xX]\]/) !== null;
      const text = line.replace(/^- \[[ xX]\]\s*/, '');
      let title = text;
      let note = '';
      const boldMatch = text.match(/^\*\*(.+?)\*\*(.*)$/);
      if (boldMatch) {
        title = boldMatch[1];
        note = boldMatch[2].replace(/^\s*-\s*/, '').trim();
      }
      currentTask = {
        id: Date.now() + Math.random(),
        title,
        note,
        checked,
        subtasks: [],
        section: currentSectionId,
      };
    } else if (currentTask && line.match(/^\s+- \[[ xX]\]/)) {
      const checked = line.match(/\[[xX]\]/) !== null;
      const subtaskText = line.replace(/^\s+- \[[ xX]\]\s*/, '');
      currentTask.subtasks.push({ text: subtaskText, checked } as Subtask);
    }
  }
  if (currentTask && currentSectionId) {
    resultTasks[currentSectionId].push(currentTask);
  }
  return { sections: resultSections, tasks: resultTasks };
}

export function toMarkdown(sections: TaskSection[], tasks: Record<string, Task[]>): string {
  let md = '# Tasks\n';
  sections.forEach((section) => {
    md += `\n## ${section.name}\n`;
    const sectionTasks = tasks[section.id] || [];
    sectionTasks.forEach((t) => {
      const checkbox = t.checked ? '[x]' : '[ ]';
      const note = t.note ? ` - ${t.note}` : '';
      md += `- ${checkbox} **${t.title}**${note}\n`;
      t.subtasks.forEach((st) => {
        const stCheckbox = st.checked ? '[x]' : '[ ]';
        md += `  - ${stCheckbox} ${st.text}\n`;
      });
    });
  });
  return md.trimEnd() + '\n';
}
