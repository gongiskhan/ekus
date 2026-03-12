export function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, , , weekday] = parts;

  const days: Record<string, string> = {
    '0': 'Dom',
    '1': 'Seg',
    '2': 'Ter',
    '3': 'Qua',
    '4': 'Qui',
    '5': 'Sex',
    '6': 'Sab',
    '1-5': 'Seg-Sex',
    '*': 'Todos os dias',
  };

  let timeStr = '';
  if (minute.startsWith('*/')) {
    const interval = minute.slice(2);
    if (hour.includes('-')) {
      timeStr = `A cada ${interval} min, ${hour.replace('-', 'h-')}h`;
    } else {
      timeStr = `A cada ${interval} min`;
    }
  } else if (hour.includes('-')) {
    if (minute === '0') {
      timeStr = `A cada hora, ${hour.replace('-', 'h-')}h`;
    } else {
      timeStr = `${hour.replace('-', 'h-')}h, min ${minute}`;
    }
  } else if (minute === '0' && !hour.includes('-') && !hour.includes('/') && hour !== '*') {
    timeStr = `${hour.padStart(2, '0')}:00`;
  } else if (hour !== '*' && minute !== '*') {
    timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  } else {
    timeStr = `${hour}:${minute}`;
  }

  const dayStr = days[weekday] || weekday;
  return `${timeStr}, ${dayStr}`;
}

export function timeAgo(dateStr: string): string {
  // Handle "2026-03-10-11-00" format
  const dashMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (dashMatch) {
    const date = new Date(+dashMatch[1], +dashMatch[2] - 1, +dashMatch[3], +dashMatch[4], +dashMatch[5]);
    return formatRelative(date);
  }

  // Handle ISO date format
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return formatRelative(date);
}

function formatRelative(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}
