interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
}

type Priority = 'high' | 'medium' | 'low';
type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';

interface ParsedTask {
  title: string;
  assignee: string;
  deadline: string | null;
  priority: Priority;
  status: TaskStatus;
  confirmation: string;
  prerequisite: string;
  category: string;
}

interface ParsedAnalysis {
  tasks: ParsedTask[];
  replyDraft: string;
}

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}


function normalizeForSourceMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]/gu, '')
    .replace(/[「」『』【】\[\]()（）〈〉《》・,，。:：;；!！?？]/gu, '');
}

function participantNames(sourceText: string): Set<string> {
  const names = new Set<string>();
  for (const line of sourceText.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:参加者|出席者)\s*[：:]\s*(.+)$/u);
    if (!match) continue;
    for (const value of match[1].split(/[、,，]/u)) {
      const name = cleanString(value);
      if (name && name.length <= 20) names.add(name);
    }
  }
  return names;
}

function isCleanPersonLabel(candidate: string, sourceText: string): boolean {
  if (candidate === '各担当者') return true;
  if (participantNames(sourceText).has(candidate)) return true;

  // 「山田さん」のような短い人名だけを許可する。
  // 「広告用の画像は山田さん」のような文章断片がassigneeに入るのを防ぐ。
  if (!/^[^\s、,，。！？!?：:\n]{1,12}(?:さん|様|氏|殿)$/u.test(candidate)) return false;
  const stem = candidate.replace(/(?:さん|様|氏|殿)$/u, '');
  if (/[はがをにへとの]/u.test(stem)) return false;
  return true;
}

function normalizeAssignee(value: unknown, sourceText: string): string {
  const candidate = cleanString(value);
  if (!candidate) return '未設定';

  const placeholders = /^(未設定|未定|不明|なし|無し|該当なし|担当者|要確認|-|—)$/u;
  if (placeholders.test(candidate)) return '未設定';
  if (!isCleanPersonLabel(candidate, sourceText)) return '未設定';

  const source = normalizeForSourceMatch(sourceText);
  const normalizedCandidate = normalizeForSourceMatch(candidate);
  if (!source || !normalizedCandidate) return '未設定';

  const withoutHonorific = normalizedCandidate.replace(/(さん|さま|様|氏|殿)$/u, '');
  const explicitlyMentioned = source.includes(normalizedCandidate)
    || (withoutHonorific.length >= 1 && source.includes(withoutHonorific));

  return explicitlyMentioned ? candidate.slice(0, 80) : '未設定';
}


interface SourceTaskContext {
  text: string;
  assignee: string;
  paragraph: string;
  previousText: string;
  nextText: string;
}

function splitParagraphs(sourceText: string): string[] {
  const normalized = sourceText.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？!?])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractLeadingAssignee(value: string): { assignee: string; rest: string } | null {
  const match = value.match(/^(.{1,30}?(?:さん|様|氏)|各担当者|担当者)\s*(?:は|が)\s*[、,]?\s*(.+)$/u);
  if (!match) return null;
  const assignee = cleanString(match[1]);
  const rest = cleanString(match[2]);
  if (!assignee || !rest) return null;
  return { assignee, rest };
}

function extractExplicitSubject(sentence: string): string {
  const leading = extractLeadingAssignee(sentence.trim());
  if (leading && isCleanPersonLabel(leading.assignee, sentence)) return leading.assignee;

  // 「広告文章は鈴木さんが担当する」のような文では、
  // 「広告用の画像は山田さん」まで担当者名として巻き込まない。
  const roleMatch = sentence.match(/(?:^|[、,，]|は)\s*([^\s、,，。！？!?：:]{1,12}(?:さん|様|氏|殿))\s*(?:が担当|を担当)/u);
  if (roleMatch && isCleanPersonLabel(roleMatch[1], sentence)) return cleanString(roleMatch[1]);
  return '';
}

function getSourceTaskContexts(sourceText: string): SourceTaskContext[] {
  const contexts: SourceTaskContext[] = [];

  for (const paragraph of splitParagraphs(sourceText)) {
    let currentAssignee = '';
    const sentences = splitSentences(paragraph);

    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      const explicit = extractExplicitSubject(sentence);
      if (explicit) currentAssignee = explicit;
      contexts.push({
        text: sentence,
        assignee: currentAssignee,
        paragraph,
        previousText: index > 0 ? sentences[index - 1] : '',
        nextText: index + 1 < sentences.length ? sentences[index + 1] : '',
      });
    }
  }

  return contexts;
}

function charBigrams(value: string): Set<string> {
  const normalized = normalizeForSourceMatch(value);
  const grams = new Set<string>();
  if (normalized.length <= 1) {
    if (normalized) grams.add(normalized);
    return grams;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function similarityScore(left: string, right: string): number {
  const leftNormalized = normalizeForSourceMatch(left);
  const rightNormalized = normalizeForSourceMatch(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) return 1;

  const leftGrams = charBigrams(leftNormalized);
  const rightGrams = charBigrams(rightNormalized);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;

  let common = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) common += 1;
  return common / Math.max(1, Math.min(leftGrams.size, rightGrams.size));
}

function extractResponsibilityPair(sentence: string, title: string): string {
  const titleNormalized = normalizeForSourceMatch(title);
  if (!titleNormalized) return '';

  const pairPattern = /([^、。！？!?]{2,40}?)は\s*(.{1,30}?(?:さん|様|氏))\s*(?=、|,|が担当|を担当|。|$)/gu;
  let bestAssignee = '';
  let bestScore = 0;

  for (const match of sentence.matchAll(pairPattern)) {
    const topic = cleanString(match[1]);
    const assignee = cleanString(match[2]);
    const score = similarityScore(topic, titleNormalized);
    if (score > bestScore) {
      bestScore = score;
      bestAssignee = assignee;
    }
  }

  return bestScore >= 0.35 ? bestAssignee : '';
}

function canonicalAssignee(value: string): string {
  return normalizeForSourceMatch(value)
    .replace(/(さん|さま|様|氏|殿)$/u, '')
    .replace(/^未設定$/u, '');
}

function findBestTaskContext(
  title: string,
  sourceText: string,
  assigneeHint = '',
): { context: SourceTaskContext | null; score: number } {
  const contexts = getSourceTaskContexts(sourceText);
  let best: SourceTaskContext | null = null;
  let bestScore = 0;
  const hintedAssignee = canonicalAssignee(assigneeHint);

  for (const context of contexts) {
    const baseScore = similarityScore(title, context.text);
    let score = baseScore;

    // 同じ語（例:「問い合わせフォーム」）が別タスクにも登場する会議メモでは、
    // タイトルだけの類似度だと別の文へ誤マッチしやすい。
    // 担当者が分かっている場合は同じ担当者の文を強く優先し、別担当の文は減点する。
    const contextAssignee = canonicalAssignee(context.assignee);
    // 担当者は「本文がある程度似ている候補」のタイブレークにだけ使う。
    // 担当者一致だけで全く別の佐藤さんタスクへ飛ばさない。
    if (baseScore >= 0.16 && hintedAssignee && contextAssignee) {
      if (hintedAssignee === contextAssignee) score = Math.min(1, score + 0.18);
      else score = Math.max(0, score - 0.08);
    }

    if (score > bestScore) {
      bestScore = score;
      best = context;
    }
  }

  return { context: best, score: bestScore };
}

function inferAssigneeFromContext(title: string, sourceText: string): string {
  const { context: best, score: bestScore } = findBestTaskContext(title, sourceText);
  if (!best || bestScore < 0.32) return '未設定';

  const paired = extractResponsibilityPair(best.text, title);
  if (paired) return normalizeAssignee(paired, sourceText);
  if (best.assignee) return normalizeAssignee(best.assignee, sourceText);
  return '未設定';
}

function isMeetingMetadata(value: string): boolean {
  return /^(?:会議名|日時|開催日時|参加者|出席者|場所|議題|アジェンダ)\s*[：:]/u.test(value.trim());
}

function isDecisionOnly(value: string): boolean {
  const text = value.trim();
  return /(?:ことを確認した|ことで合意した|ことを決定した|方針とした|方針を確認した|で進めることを確認した|とすることを確認した)[。！!]?$/u.test(text);
}

function isStatusOnly(value: string): boolean {
  const text = value.trim();
  return /^(?:(?:[^。！？!?]{1,40}について[、,]\s*)?現在[、,]?|現時点で|進捗として)[\s\S]*(?:ほぼ完成している|未確定となっている|判明した|状況である|状態である)[。！!]?$/u.test(text);
}

function isDetailOnly(value: string): boolean {
  const text = value.trim();
  return /^(?:確認項目|対象項目|チェック項目|内訳|内容)には?[、,\s\S]*(?:含める|含む)[。！!]?$/u.test(text);
}

function isVagueTaskTitle(value: string): boolean {
  const normalized = normalizeForSourceMatch(value);
  return /^(?:担当する|対応する|作成する|確認する|共有する|報告する|完成させる|実施する)$/u.test(normalized);
}

function isMeaninglessTaskTitle(value: string): boolean {
  return /^(?:担当する)$/u.test(normalizeForSourceMatch(value));
}

function isNonActionableTask(title: string, sourceText: string, assigneeHint = ''): boolean {
  if (isMeetingMetadata(title) || isDecisionOnly(title) || isStatusOnly(title) || isDetailOnly(title)) return true;
  const { context, score } = findBestTaskContext(title, sourceText, assigneeHint);
  if (!context || score < 0.28) return false;
  return isMeetingMetadata(context.text) || isDecisionOnly(context.text) || isStatusOnly(context.text) || isDetailOnly(context.text);
}

function jstTodayDate(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dateFromJapaneseText(value: string): string | null {
  const text = value.normalize('NFKC');
  const iso = text.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/u);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const today = jstTodayDate();
  if (/明後日/u.test(text)) {
    today.setUTCDate(today.getUTCDate() + 2);
    return formatDateOnly(today);
  }
  if (/明日/u.test(text)) {
    today.setUTCDate(today.getUTCDate() + 1);
    return formatDateOnly(today);
  }
  if (/(?:本日|今日)/u.test(text)) return formatDateOnly(today);

  if (/来月末/u.test(text)) {
    return formatDateOnly(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0)));
  }
  if (/(?:今月末|月末)/u.test(text)) {
    return formatDateOnly(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));
  }

  const jp = text.match(/(?:(20\d{2})年)?([01]?\d)月([0-3]?\d)日/u);
  if (!jp) return null;
  const year = jp[1] ? Number(jp[1]) : today.getUTCFullYear();
  const month = Number(jp[2]);
  const day = Number(jp[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferDeadlineFromContext(title: string, sourceText: string, assigneeHint = ''): string | null {
  const { context, score } = findBestTaskContext(title, sourceText, assigneeHint);
  if (!context || score < 0.28) return null;

  const direct = dateFromJapaneseText(context.text);
  if (direct) return direct;

  // 「あわせて〜」は直前の担当・期限を引き継ぐことが多い。
  if (/^(?:あわせて|併せて|合わせて)[、,\s]/u.test(context.text)) {
    const previous = dateFromJapaneseText(context.previousText);
    if (previous) return previous;
  }

  // 「期限は8月22日」「8月21日までに素材を完成」など、直後に期限だけ書かれるケース。
  if (/(?:期限|締切|までに|までとする|まで)/u.test(context.nextText)) {
    const next = dateFromJapaneseText(context.nextText);
    if (next) return next;
  }

  return null;
}

function explicitPriority(value: string): Priority | null {
  const text = value.normalize('NFKC');
  if (/優先度\s*(?:は|：|:)?\s*(?:高|high)(?:\s*とする)?/iu.test(text)) return 'high';
  if (/優先度\s*(?:は|：|:)?\s*(?:低|low)(?:\s*とする)?/iu.test(text)) return 'low';
  if (/優先度\s*(?:は|：|:)?\s*(?:中|medium)(?:\s*とする)?/iu.test(text)) return 'medium';
  return null;
}

interface ExplicitPriorityHint {
  priority: Priority;
  markerText: string;
  anchorText: string;
  assignee: string;
  paragraph: string;
}

function looksActionableSentence(value: string): boolean {
  if (!value || isMeetingMetadata(value) || isDecisionOnly(value) || isStatusOnly(value)) return false;
  if (explicitPriority(value)) return false;
  return /(担当|調査|報告|共有|作成|確認|対応|テスト|完成|依頼|更新|提出|送付|連絡|整理|修正|反映|開始)/u.test(value);
}

function extractExplicitPriorityHints(sourceText: string): ExplicitPriorityHint[] {
  const hints: ExplicitPriorityHint[] = [];

  for (const paragraph of splitParagraphs(sourceText)) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) continue;
    const contexts = getSourceTaskContexts(paragraph);

    for (let index = 0; index < sentences.length; index += 1) {
      const markerText = sentences[index];
      const priority = explicitPriority(markerText);
      if (!priority) continue;

      let anchorText = markerText;
      // 「優先度は高とする。」のような独立文なら、直前の実行文へ結び付ける。
      if (/^優先度\s*(?:は|：|:)/u.test(markerText.normalize('NFKC'))) {
        anchorText = '';
        for (let cursor = index - 1; cursor >= Math.max(0, index - 4); cursor -= 1) {
          const candidate = sentences[cursor];
          if (looksActionableSentence(candidate)) {
            anchorText = candidate;
            break;
          }
        }
      }

      if (!anchorText) continue;
      const anchorContext = contexts.find(
        (item) => normalizeForSourceMatch(item.text) === normalizeForSourceMatch(anchorText),
      );
      hints.push({
        priority,
        markerText,
        anchorText,
        assignee: anchorContext?.assignee ?? extractExplicitSubject(anchorText),
        paragraph,
      });
    }
  }

  return hints;
}

function priorityHintMatchScore(title: string, assigneeHint: string, hint: ExplicitPriorityHint): number {
  const base = similarityScore(title, hint.anchorText);
  let score = base;
  const taskAssignee = canonicalAssignee(assigneeHint);
  const hintAssignee = canonicalAssignee(hint.assignee);

  // 優先度は誤付与の影響が大きいので、担当者一致は本文が十分似ている場合だけ小さく加点する。
  // 「同じ佐藤さん」という理由だけで別タスクをhighにしない。
  if (base >= 0.35 && taskAssignee && hintAssignee) {
    if (taskAssignee === hintAssignee) score = Math.min(1, score + 0.10);
    else score = Math.max(0, score - 0.10);
  }
  return score;
}

function inferPriorityFromContext(title: string, sourceText: string, rawPriority: unknown, assigneeHint = ''): Priority {
  const { context, score } = findBestTaskContext(title, sourceText, assigneeHint);

  if (context && score >= 0.24) {
    const paragraphSentences = splitSentences(context.paragraph);
    const contextIndex = paragraphSentences.findIndex(
      (sentence) => normalizeForSourceMatch(sentence) === normalizeForSourceMatch(context.text),
    );

    // まず、マッチした文の周辺にある明示優先度を確認する。
    const nearbySentences = contextIndex >= 0
      ? paragraphSentences.slice(Math.max(0, contextIndex - 1), contextIndex + 4)
      : [context.previousText, context.text, context.nextText];

    for (const sentence of nearbySentences) {
      const explicit = explicitPriority(sentence);
      if (explicit) return explicit;
    }

    const localScope = nearbySentences.join(' ');
    if (/最優先|至急|緊急|急ぎ|本日中|今日中/iu.test(localScope)) return 'high';
    if (/可能であれば|余裕があれば/iu.test(localScope)) return 'low';
  }

  // AIのタスク名が元文と少し言い換わっていても、
  // 「優先度は高」の直前実行文をアンカーとして全体から再照合する。
  let bestHint: ExplicitPriorityHint | null = null;
  let bestHintScore = 0;
  for (const hint of extractExplicitPriorityHints(sourceText)) {
    const hintScore = priorityHintMatchScore(title, assigneeHint, hint);
    if (hintScore > bestHintScore) {
      bestHintScore = hintScore;
      bestHint = hint;
    }
  }
  if (bestHint && bestHintScore >= 0.55) return bestHint.priority;

  // AIが根拠なくhigh/lowを返すことがあるため、優先度は本文根拠だけで決める。
  // 明示指定や緊急語がない通常タスクはmediumとする。
  void rawPriority;
  return 'medium';
}

function inferStatusFromContext(title: string, sourceText: string, rawStatus: unknown, assigneeHint = ''): TaskStatus {
  const { context, score } = findBestTaskContext(title, sourceText, assigneeHint);
  const scope = context && score >= 0.28 ? `${context.text} ${context.paragraph}` : '';

  if (/(?:完了済み|対応済み|作成済み|確認済み|実施済み|提出済み|送付済み|完了した|対応した|実施した|終了した|完了している)/u.test(scope)) return 'done';
  if (/(?:確認待ち|承認待ち|回答待ち|返答待ち|返信待ち|連絡待ち)/u.test(scope)) return 'waiting';
  if (/(?:対応中|作業中|進行中|実施中|確認中|作成中|調査中|着手済み|ほぼ完成)/u.test(scope)) return 'doing';
  return isStatus(rawStatus) ? rawStatus : 'todo';
}

function normalizeTaskIdentity(rawTitle: string, rawAssignee: unknown, sourceText: string): { title: string; assignee: string } {
  let title = cleanString(rawTitle);
  const leading = extractLeadingAssignee(title);
  const candidateAssignee = leading?.assignee || cleanString(rawAssignee);

  if (leading) title = leading.rest;

  let assignee = normalizeAssignee(candidateAssignee, sourceText);
  if (assignee === '未設定') assignee = inferAssigneeFromContext(title, sourceText);

  const secondPass = extractLeadingAssignee(title);
  if (secondPass) title = secondPass.rest;

  return {
    title: title.slice(0, 180),
    assignee,
  };
}

function isPriority(value: unknown): value is Priority {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'doing' || value === 'waiting' || value === 'done';
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeSourceType(value: unknown): string {
  const source = cleanString(value, 'email');
  return ['email', 'chat', 'meeting', 'work', 'free'].includes(source) ? source : 'email';
}

function dateAfter(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function sentenceToTask(sentence: string, index: number, sourceText: string): ParsedTask {
  const compact = sentence.replace(/^(また|なお|そして|可能であれば)[、\s]*/, '').trim();
  const title = compact
    .replace(/(を)?お願いします[。！!]?$/u, 'する')
    .replace(/してください[。！!]?$/u, 'する')
    .replace(/いただけると助かります[。！!]?$/u, 'する')
    .replace(/よろしくお願いします[。！!]?$/u, '')
    .trim();

  let priority: Priority = 'medium';
  if (/至急|本日中|今日中|急ぎ|最優先/u.test(sentence)) priority = 'high';
  if (/可能であれば|余裕があれば/u.test(sentence)) priority = 'low';

  return {
    title: title || `依頼内容を確認する ${index + 1}`,
    assignee: '未設定',
    deadline: inferDeadlineFromContext(title, sourceText),
    priority: inferPriorityFromContext(title, sourceText, priority),
    status: inferStatusFromContext(title, sourceText, 'todo'),
    confirmation: /確認/u.test(sentence) ? '確認対象と判断基準を確認' : '完了条件を確認',
    prerequisite: '',
    category: /見積|請求|経費/u.test(sentence)
      ? '経理・請求'
      : /会議|打ち合わせ|アジェンダ/u.test(sentence)
        ? '会議準備'
        : /資料|文書/u.test(sentence)
          ? '資料作成'
          : /共有|報告/u.test(sentence)
            ? '報告'
            : '業務',
  };
}

interface ParallelResponsibilityTask extends ParsedTask {
  sourceSentence: string;
  sharedDeadlineSentence: string;
}

function topicToTaskTitle(topic: string): string {
  const cleaned = topic
    .replace(/^(?:また|なお|あわせて|併せて|合わせて)[、,\s]*/u, '')
    .replace(/[はがを]\s*$/u, '')
    .trim();
  if (!cleaned) return '';
  if (/(?:画像|バナー|デザイン|文章|文面|原稿|コピー|資料|素材)$/u.test(cleaned)) return `${cleaned}を作成する`;
  return `${cleaned}を担当する`;
}

function extractParallelResponsibilityTasks(sourceText: string): ParallelResponsibilityTask[] {
  const result: ParallelResponsibilityTask[] = [];

  for (const paragraph of splitParagraphs(sourceText)) {
    const sentences = splitSentences(paragraph);
    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      const pairs: Array<{ topic: string; assignee: string }> = [];
      const pairPattern = /(?:^|[、,，])\s*([^、,，。！？!?]{2,40}?)は\s*([^\s、,，。！？!?：:]{1,12}(?:さん|様|氏|殿))(?=\s*(?:[、,，]|が担当|を担当|。|$))/gu;
      for (const match of sentence.matchAll(pairPattern)) {
        const topic = cleanString(match[1]);
        const assignee = normalizeAssignee(match[2], sourceText);
        if (!topic || assignee === '未設定') continue;
        pairs.push({ topic, assignee });
      }

      // 1文に複数の「AはXさん、BはYさん」がある場合だけ、確定ルールとして分割する。
      if (pairs.length < 2 || !/(?:担当する|担当とする)/u.test(sentence)) continue;

      const nextText = index + 1 < sentences.length ? sentences[index + 1] : '';
      const sharedDeadline = /(?:期限|までに|まで)/u.test(nextText) ? dateFromJapaneseText(nextText) : null;
      for (const pair of pairs) {
        const title = topicToTaskTitle(pair.topic);
        if (!title) continue;
        result.push({
          title,
          assignee: pair.assignee,
          deadline: sharedDeadline ?? dateFromJapaneseText(sentence),
          priority: inferPriorityFromContext(title, sourceText, 'medium', pair.assignee),
          status: inferStatusFromContext(title, sourceText, 'todo', pair.assignee),
          confirmation: '成果物の内容と完了条件を確認',
          prerequisite: '',
          category: /広告|SNS/u.test(paragraph) ? '広告・販促' : '業務',
          sourceSentence: sentence,
          sharedDeadlineSentence: sharedDeadline ? nextText : '',
        });
      }
    }
  }

  return result;
}

function applyParallelResponsibilityRules(tasks: ParsedTask[], sourceText: string): ParsedTask[] {
  const parallel = extractParallelResponsibilityTasks(sourceText);
  if (parallel.length === 0) return tasks;

  const sourceSentences = new Set(parallel.map((task) => normalizeForSourceMatch(task.sourceSentence)));
  const deadlineSentences = new Set(
    parallel.map((task) => normalizeForSourceMatch(task.sharedDeadlineSentence)).filter(Boolean),
  );

  const filtered = tasks.filter((task) => {
    const { context, score } = findBestTaskContext(task.title, sourceText, task.assignee);
    const contextKey = context ? normalizeForSourceMatch(context.text) : '';

    // AIが「担当する」だけをタスク化したケースや、
    // 共有期限文「8月21日までに素材を完成させる」を別タスク化したケースを除く。
    if (isVagueTaskTitle(task.title) && contextKey && sourceSentences.has(contextKey)) return false;
    if (score >= 0.30 && contextKey && deadlineSentences.has(contextKey)) return false;

    // 正しく具体化済みのタスクは後段で決定論タスクとマージするので残してよい。
    return true;
  });

  const merged = [...filtered];
  for (const deterministic of parallel) {
    const existingIndex = merged.findIndex((task) => {
      const titleScore = similarityScore(task.title, deterministic.title);
      const sameAssignee = canonicalAssignee(task.assignee) === canonicalAssignee(deterministic.assignee);
      return titleScore >= 0.88 || (sameAssignee && titleScore >= 0.58);
    });
    const cleanTask: ParsedTask = {
      title: deterministic.title,
      assignee: deterministic.assignee,
      deadline: deterministic.deadline,
      priority: deterministic.priority,
      status: deterministic.status,
      confirmation: deterministic.confirmation,
      prerequisite: deterministic.prerequisite,
      category: deterministic.category,
    };
    if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...cleanTask };
    else merged.push(cleanTask);
  }

  return merged;
}

function applyExplicitPriorityHints(tasks: ParsedTask[], sourceText: string): ParsedTask[] {
  const result = tasks.map((task) => ({ ...task }));

  for (const hint of extractExplicitPriorityHints(sourceText)) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < result.length; index += 1) {
      const score = priorityHintMatchScore(result[index].title, result[index].assignee, hint);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.55) {
      result[bestIndex] = { ...result[bestIndex], priority: hint.priority };
      continue;
    }

    // AIが重要タスク自体を出力しなかった場合も、明示優先度付きの実行文は落とさない。
    if (!looksActionableSentence(hint.anchorText)) continue;
    const parsed = sentenceToTask(hint.anchorText, result.length, sourceText);
    const identity = normalizeTaskIdentity(parsed.title, hint.assignee || parsed.assignee, sourceText);
    const candidate: ParsedTask = {
      ...parsed,
      title: identity.title,
      assignee: identity.assignee,
      deadline: inferDeadlineFromContext(identity.title, sourceText, identity.assignee),
      priority: hint.priority,
      status: inferStatusFromContext(identity.title, sourceText, parsed.status, identity.assignee),
    };
    if (!candidate.title || isNonActionableTask(candidate.title, sourceText, candidate.assignee)) continue;
    if (result.some((task) => similarityScore(task.title, candidate.title) >= 0.72)) continue;
    result.push(candidate);
  }

  return result.slice(0, 30);
}


function stripReviewHint(value: string): string {
  return value
    .split(/\s*\/\s*/u)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('要確認：'))
    .join(' / ')
    .trim();
}

function normalizeReviewConfirmation(confirmation: string, assignee: string, deadline: string | null): string {
  const base = stripReviewHint(cleanString(confirmation));
  const missing: string[] = [];
  if (!assignee || assignee === '未設定') missing.push('担当者を確認');
  if (!deadline) missing.push('期限を確認');
  if (missing.length === 0) return base.slice(0, 180);
  return `${base ? `${base} / ` : ''}要確認：${missing.join('・')}`.slice(0, 180);
}

function appendReviewHints(task: ParsedTask): ParsedTask {
  return {
    ...task,
    confirmation: normalizeReviewConfirmation(task.confirmation, task.assignee, task.deadline),
  };
}

function canonicalizePrerequisites(tasks: ParsedTask[]): ParsedTask[] {
  return tasks.map((task, index) => {
    const raw = cleanString(task.prerequisite);
    if (!raw) return { ...task, prerequisite: '' };

    let bestTitle = '';
    let bestScore = 0;
    tasks.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index) return;
      const score = similarityScore(raw, candidate.title);
      if (score > bestScore) {
        bestScore = score;
        bestTitle = candidate.title;
      }
    });

    // 実際に抽出された別タスクへ十分近い場合だけ採用し、AIの架空依存を捨てる。
    return { ...task, prerequisite: bestScore >= 0.58 ? bestTitle : '' };
  });
}


function applyDependencyStatuses(tasks: ParsedTask[]): ParsedTask[] {
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  return tasks.map((task) => {
    if (!task.prerequisite) return task;
    const prerequisite = byTitle.get(task.prerequisite);
    if (!prerequisite) return task;
    if (prerequisite.status === 'done') {
      return task.status === 'waiting' ? { ...task, status: 'todo' } : task;
    }
    return { ...task, status: 'waiting' };
  });
}

async function reconcileDependencyStatuses(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE tasks
      SET status = 'waiting'
      WHERE prerequisite <> ''
        AND status <> 'done'
        AND EXISTS (
          SELECT 1 FROM tasks AS parent
          WHERE parent.title = tasks.prerequisite
            AND (tasks.analysis_id IS NULL OR parent.analysis_id = tasks.analysis_id)
            AND parent.status <> 'done'
        )
    `),
    env.DB.prepare(`
      UPDATE tasks
      SET status = 'todo'
      WHERE prerequisite <> ''
        AND status = 'waiting'
        AND EXISTS (
          SELECT 1 FROM tasks AS parent
          WHERE parent.title = tasks.prerequisite
            AND (tasks.analysis_id IS NULL OR parent.analysis_id = tasks.analysis_id)
            AND parent.status = 'done'
        )
    `),
  ]);
}

function normalizeActionPhrase(value: string): string {
  let text = value
    .replace(/^[、,\s]+/u, '')
    .replace(/^(?:また|なお|あわせて|併せて|合わせて)[、,\s]*/u, '')
    .replace(/^(?:(?:本日|今日|明日|明後日|今月末|来月末|月末)|(?:20\d{2}年)?[01]?\d月[0-3]?\d日)(?:の(?:午前|午後|朝|夕方|夜))?(?:中)?までに/u, '')
    .replace(/(?:してください|お願いします|して下さい|すること)[。！!]?$/u, '')
    .replace(/[。！!]+$/u, '')
    .trim();
  if (!text) return '';
  if (/(?:する|確認する|作成する|送付する|共有する|提出する|報告する|連絡する|反映する|公開する)$/u.test(text)) return text;
  if (/(?:確認|作成|送付|共有|提出|報告|連絡|反映|公開|更新|修正)$/u.test(text)) return `${text}する`;
  return text;
}

function extractDelegatedAssignee(sentence: string): string {
  const match = sentence.match(/([^\s、,，。！？!?：:に]{1,12}(?:さん|様|氏|殿))に[^。！？!?]{0,100}?(?:してもら|を依頼)/u);
  return match ? normalizeAssignee(match[1], sentence) : '未設定';
}

function extractWorkRequestTasks(sourceText: string): ParsedTask[] {
  const result: ParsedTask[] = [];
  const add = (task: ParsedTask) => {
    if (!task.title || isMeaninglessTaskTitle(task.title)) return;
    const duplicate = result.findIndex((candidate) => similarityScore(candidate.title, task.title) >= 0.88);
    if (duplicate >= 0) {
      const current = result[duplicate];
      result[duplicate] = {
        ...current,
        assignee: current.assignee === '未設定' && task.assignee !== '未設定' ? task.assignee : current.assignee,
        deadline: current.deadline ?? task.deadline,
        prerequisite: current.prerequisite || task.prerequisite,
      };
      return;
    }
    result.push(task);
  };

  for (const sentence of splitSentences(sourceText)) {
    // 「田中さんに売上資料を確認してもらい」のような明示的な委任を独立タスク化。
    const delegated = sentence.match(/([^\s、,，。！？!?：:に]{1,12}(?:さん|様|氏|殿))に([^、,，。！？!?]{1,80}?)を(確認|作成|更新|修正|テスト|調査)(?:してもら(?:い|って|う)|するよう依頼)/u);
    let delegatedTitle = '';
    if (delegated) {
      delegatedTitle = `${cleanString(delegated[2])}を${cleanString(delegated[3])}する`;
      add(appendReviewHints({
        title: delegatedTitle,
        assignee: normalizeAssignee(delegated[1], sourceText),
        deadline: dateFromJapaneseText(sentence),
        priority: inferPriorityFromContext(delegatedTitle, sourceText, 'medium', delegated[1]),
        status: inferStatusFromContext(delegatedTitle, sourceText, 'todo', delegated[1]),
        confirmation: '完了条件を確認',
        prerequisite: '',
        category: /資料|表/u.test(delegatedTitle) ? '資料作成' : '業務',
      }));
    }

    // 「確認後に送付」「問題がなければ送付」「〜してから共有」など、明示された後続作業。
    const followUp = sentence.match(/(?:問題がなければ|確認後(?:に)?|完了後(?:に)?|作成後(?:に)?|対応後(?:に)?|処理後(?:に)?|してから)\s*([^。！？!?]{1,100}?)(?:してください|お願いします|する)?[。！？!?]?$/u);
    if (followUp) {
      let title = normalizeActionPhrase(followUp[1]);
      if (title && delegated && /(?:送付|共有|提出|報告|連絡)する$/u.test(title) && !/を/u.test(title)) {
        title = `${cleanString(delegated[2])}を${title}`;
      }
      if (title) {
        add(appendReviewHints({
          title,
          assignee: extractDelegatedAssignee(followUp[1]),
          deadline: dateFromJapaneseText(sentence),
          priority: inferPriorityFromContext(title, sourceText, 'medium'),
          status: inferStatusFromContext(title, sourceText, 'todo'),
          confirmation: '前提タスクの完了を確認',
          prerequisite: delegatedTitle,
          category: /送付|共有|報告|連絡/u.test(title) ? '報告' : '業務',
        }));
      }
    }

    // 「取引先への共有も必要」のような必要作業表現もタスク化する。
    const necessary = sentence.match(/([^。！？!?]{1,60}?)(?:への|へ)共有も必要/u);
    if (necessary) {
      const target = cleanString(necessary[1]).replace(/^(?:また|あわせて|併せて)[、,\s]*/u, '');
      const title = `${target}へ共有する`;
      add(appendReviewHints({
        title,
        assignee: '未設定',
        deadline: dateFromJapaneseText(sentence),
        priority: inferPriorityFromContext(title, sourceText, 'medium'),
        status: 'todo',
        confirmation: '共有内容と共有方法を確認',
        prerequisite: '',
        category: '報告',
      }));
    }

    // 通常の「〜してください」を1タスクとして補完。複合文は上の確定ルールと重複排除する。
    if (/(?:してください|お願いします)/u.test(sentence) && !delegated && !followUp) {
      const generic = sentenceToTask(sentence, result.length, sourceText);
      const identity = normalizeTaskIdentity(generic.title, generic.assignee, sourceText);
      const cleanedTitle = normalizeActionPhrase(identity.title);
      if (cleanedTitle && !isNonActionableTask(cleanedTitle, sourceText, identity.assignee)) {
        add(appendReviewHints({
          ...generic,
          title: cleanedTitle,
          assignee: identity.assignee,
          deadline: inferDeadlineFromContext(cleanedTitle, sourceText, identity.assignee),
          prerequisite: '',
        }));
      }
    }
  }

  return canonicalizePrerequisites(result).slice(0, 30);
}

function enhanceWorkTasks(tasks: ParsedTask[], sourceText: string): ParsedTask[] {
  const merged = tasks.map((task) => ({ ...task }));
  for (const deterministic of extractWorkRequestTasks(sourceText)) {
    const index = merged.findIndex((task) => similarityScore(task.title, deterministic.title) >= 0.72);
    if (index >= 0) {
      const current = merged[index];
      merged[index] = {
        ...current,
        assignee: current.assignee === '未設定' && deterministic.assignee !== '未設定' ? deterministic.assignee : current.assignee,
        deadline: current.deadline ?? deterministic.deadline,
        prerequisite: current.prerequisite || deterministic.prerequisite,
      };
    } else {
      merged.push(deterministic);
    }
  }
  return canonicalizePrerequisites(merged.map(appendReviewHints)).slice(0, 30);
}

function fallbackWorkAnalyze(text: string, tone: string): ParsedAnalysis {
  let tasks = extractWorkRequestTasks(text);
  if (tasks.length === 0) {
    tasks = [appendReviewHints({
      title: '依頼内容を確認する',
      assignee: '未設定',
      deadline: null,
      priority: 'medium',
      status: 'todo',
      confirmation: '実行する作業内容を確認',
      prerequisite: '',
      category: '確認',
    })];
  }

  const bulletLines = tasks.map((task) => `・${task.title}`).join('\n');
  const opening = tone === '簡潔'
    ? 'ご依頼ありがとうございます。以下の内容で整理しました。'
    : tone === 'やわらかい'
      ? 'ご依頼ありがとうございます。対応内容を以下の通り整理しました。'
      : 'お疲れさまです。ご依頼内容を確認し、以下の通り対応タスクを整理しました。';
  return { tasks, replyDraft: `${opening}\n\n${bulletLines}\n\n不足している担当者・期限は確認のうえ確定します。` };
}

function fallbackAnalyze(text: string, tone: string, sourceType = 'email'): ParsedAnalysis {
  if (sourceType === 'work') return fallbackWorkAnalyze(text, tone);
  const knownTasks: ParsedTask[] = [];
  const addKnown = (condition: boolean, task: ParsedTask) => {
    if (condition && !knownTasks.some((item) => item.title === task.title)) knownTasks.push(task);
  };

  addKnown(/資料.{0,12}(更新|修正)/u.test(text), {
    title: '資料を更新する',
    assignee: '未設定',
    deadline: dateAfter(1),
    priority: 'high',
    status: 'todo',
    confirmation: '更新対象と共有範囲を確認',
    prerequisite: '',
    category: '資料作成',
  });
  addKnown(/アジェンダ/u.test(text), {
    title: '打ち合わせのアジェンダを作成する',
    assignee: '未設定',
    deadline: dateAfter(2),
    priority: 'medium',
    status: 'todo',
    confirmation: '議題・参加者・所要時間を確認',
    prerequisite: '',
    category: '会議準備',
  });
  addKnown(/見積書/u.test(text), {
    title: '見積書を確認する',
    assignee: '未設定',
    deadline: dateAfter(2),
    priority: 'medium',
    status: 'todo',
    confirmation: '金額・納期・条件を確認',
    prerequisite: '',
    category: '経理・請求',
  });
  addKnown(/進捗.{0,10}(共有|報告)/u.test(text), {
    title: '進捗を関係者へ共有する',
    assignee: '未設定',
    deadline: dateAfter(3),
    priority: 'high',
    status: 'todo',
    confirmation: '完了事項・課題・次の対応を整理',
    prerequisite: '',
    category: '報告',
  });

  const sentences = text
    .split(/[。\n]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 5
      && !isMeetingMetadata(value)
      && !isDecisionOnly(value)
      && /(お願い|してください|対応|作成|確認|共有|提出|送付|更新|連絡|担当|調査|テスト|完成|依頼)/u.test(value));

  // fallbackでも文章後半の重要タスクを落とさない。
  // 以前はknownTasksが1件でもあると他の文を捨て、さらに先頭8件で打ち切っていた。
  const parsedSentenceTasks = sentences.slice(0, 24).map((sentence, index) => sentenceToTask(sentence, index, text));
  const tasks = [...knownTasks, ...parsedSentenceTasks].filter((task, index, all) => (
    all.findIndex((candidate) => similarityScore(candidate.title, task.title) >= 0.92) === index
  ));

  if (tasks.length === 0) {
    tasks.push({
      title: '文章の依頼内容を確認する',
      assignee: '未設定',
      deadline: null,
      priority: 'medium',
      status: 'todo',
      confirmation: '目的・期限・担当者を確認',
      prerequisite: '',
      category: '確認',
    });
  }

  const normalizedTasks = applyExplicitPriorityHints(
    applyParallelResponsibilityRules(tasks, text)
      .map((task) => {
        const identity = normalizeTaskIdentity(task.title, task.assignee, text);
        return {
          ...task,
          title: identity.title,
          assignee: identity.assignee,
          deadline: inferDeadlineFromContext(identity.title, text, identity.assignee),
          priority: inferPriorityFromContext(identity.title, text, task.priority, identity.assignee),
          status: inferStatusFromContext(identity.title, text, task.status, identity.assignee),
        };
      })
      .filter((task) => !isMeaninglessTaskTitle(task.title) && !isNonActionableTask(task.title, text, task.assignee)),
    text,
  );

  const bulletLines = normalizedTasks.map((task) => `・${task.title}`).join('\n');
  const opening = tone === '簡潔'
    ? 'ご連絡ありがとうございます。以下の内容で対応します。'
    : tone === 'やわらかい'
      ? 'ご連絡ありがとうございます。内容を確認しました。以下の順で進めてまいります。'
      : 'お疲れさまです。ご連絡ありがとうございます。ご依頼いただいた内容を確認し、以下の通り対応いたします。';

  return {
    tasks: normalizedTasks,
    replyDraft: `${opening}\n\n${bulletLines}\n\n進捗があり次第、改めてご共有いたします。引き続きよろしくお願いいたします。`,
  };
}

function normalizeAnalysis(value: unknown, text: string, tone: string, sourceType = 'email'): ParsedAnalysis {
  if (!value || typeof value !== 'object') return fallbackAnalyze(text, tone, sourceType);
  const candidate = value as { tasks?: unknown; replyDraft?: unknown };
  if (!Array.isArray(candidate.tasks)) return fallbackAnalyze(text, tone, sourceType);

  const normalized = candidate.tasks
    .slice(0, 24)
    .map((raw): ParsedTask | null => {
      if (!raw || typeof raw !== 'object') return null;
      const task = raw as Record<string, unknown>;
      const rawTitle = cleanString(task.title);
      if (!rawTitle || isMeaninglessTaskTitle(rawTitle)) return null;
      const identity = normalizeTaskIdentity(rawTitle, task.assignee, text);
      if (!identity.title) return null;
      if (isNonActionableTask(identity.title, text, identity.assignee)) return null;
      const deadline = inferDeadlineFromContext(identity.title, text, identity.assignee);
      return {
        title: identity.title,
        assignee: identity.assignee,
        // AIが入力にない日付を補完しても採用せず、元文章で根拠が取れた期限だけを使う。
        deadline,
        priority: inferPriorityFromContext(identity.title, text, task.priority, identity.assignee),
        status: inferStatusFromContext(identity.title, text, task.status, identity.assignee),
        confirmation: normalizeReviewConfirmation(cleanString(task.confirmation).slice(0, 180), identity.assignee, deadline),
        prerequisite: cleanString(task.prerequisite).slice(0, 180),
        category: cleanString(task.category, '業務').slice(0, 80),
      };
    })
    .filter((task): task is ParsedTask => task !== null);

  let tasks = applyExplicitPriorityHints(applyParallelResponsibilityRules(normalized, text), text);
  tasks = sourceType === 'work' ? enhanceWorkTasks(tasks, text) : canonicalizePrerequisites(tasks);
  if (tasks.length === 0) return fallbackAnalyze(text, tone, sourceType);

  return {
    tasks,
    replyDraft: cleanString(candidate.replyDraft, fallbackAnalyze(text, tone, sourceType).replyDraft).slice(0, 3000),
  };
}

async function analyzeWithAI(env: Env, text: string, sourceType: string, tone: string): Promise<{ data: ParsedAnalysis; model: string }> {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const prompt = `あなたは日本企業の事務業務を支援するAIです。入力文章から、実行可能なタスク、担当者、期限、優先度、確認事項、カテゴリを抽出し、返信文の下書きも作成してください。

今日の日付: ${today}
文章の種類: ${sourceType}
返信トーン: ${tone}

必ず次のJSON形式だけを返してください。
{
  "tasks": [
    {
      "title": "担当者名を含めず、動詞で終わる具体的なタスク。『山田さんは、〜する』なら山田さんはtitleに入れない",
      "assignee": "入力文章に明記された実行担当者名・役割のみ。前の文で担当者が明示され、同じ段落で作業が続く場合はその担当者を引き継ぐ。明記がなければ必ず未設定",
      "deadline": "YYYY-MM-DD。推測不能ならnull",
      "priority": "high | medium | low。本文に「優先度は高」等があれば必ず反映",
      "status": "todo | doing | waiting | done。未着手=todo、作業中=doing、返信・承認待ち=waiting、完了済み=done",
      "confirmation": "作業前後に確認すべき点。担当者または期限が明記されていなければ、その不足も具体的に記載",
      "prerequisite": "このタスクの前に完了している必要がある別タスクのtitle。前提がなければ空文字",
      "category": "短い業務カテゴリ"
    }
  ],
  "replyDraft": "そのまま送れる日本語の返信文"
}

追加ルール:
- 会議名・日時・参加者などの会議メタ情報はタスクにしない。
- 「〜することを確認した」「〜で進めることを確認した」などの決定事項・共有事項だけの文は、実行作業がなければタスクにしない。
- 『現在〜ほぼ完成している』『〜が判明した』など、状況説明だけで実行作業を指示していない文もタスクにしない。
- 優先度が本文に明記されている場合は必ず反映する。『優先度は高とする』がタスクの直後の独立した文にある場合も、その直前タスクをhighにする。至急・緊急・最優先もhighとして扱う。
- すでに完了した作業はstatus=done、進行中はdoing、相手の返信・承認待ちはwaiting、これから着手するものだけtodoにする。
- titleには担当者名、期限、優先度ラベルを混ぜず、作業内容だけを書く。
- 「XさんはAする。あわせてBする。」のBも、同じ段落内で別の担当者が示されない限りXさんの担当として扱う。
- 「Xさんへ共有する」のXさんは共有先であり、実行担当者ではない。
- 「広告用の画像は山田さん、広告文章は鈴木さんが担当する」のような並列担当は、必ず「広告用の画像を作成する／山田さん」「広告文章を作成する／鈴木さん」のように担当ごとの具体的なタスクへ分ける。「担当する」だけのタスクは作らない。
- 文章の種類がwork（業務依頼）の場合は、1文に複数の作業が含まれていても必ず実行単位へ分解する。
- 「Aを確認し、問題なければBを送付」「A完了後にB」「AしてからB」のようにBがAの完了を前提とする場合、BのprerequisiteにはAのtask titleを正確に入れる。単なる文章順では前提扱いしない。
- 担当者や期限が明記されていない場合は勝手に補完しない。assigneeは未設定、deadlineはnullとし、confirmationに「担当者を確認」「期限を確認」など不足情報を書く。

入力文章:
${text}`;

  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: 'JSON以外は出力しないでください。会議名・日時・参加者や、すでに合意・確認済みの決定事項だけの文章はタスク化しないでください。担当者は入力文章に明記された実行担当者だけをassigneeへ入れ、titleには担当者名を含めないでください。「Xさんは、Aする。あわせてBする」のように同じ段落で担当者が継続する場合、AもBもassigneeはXさんです。宛先・共有先（Xさんへ共有）は実行担当者ではありません。担当者の明記がなければ必ず「未設定」にし、プロフィール名や架空名を補完してはいけません。事実のない期限は作らず、本文に明記された優先度と進捗状態は必ず反映してください。業務依頼では複数作業を実行単位に分け、明示的な「確認後」「完了後」「問題なければ」「〜してから」等の前後関係がある場合だけ後続タスクのprerequisiteへ前提タスクのtitleを入れてください。担当者・期限が不足している場合は補完せず、confirmationへ不足項目を記載してください。「AはXさん、BはYさんが担当する」のような並列担当は、A/XさんとB/Yさんの具体的な別タスクに分け、「担当する」だけの曖昧なタスクは作らないでください。' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2800,
    }) as unknown;

    const responseText = typeof result === 'object' && result !== null && 'response' in result
      ? cleanString((result as { response?: unknown }).response)
      : '';
    const parsed = responseText ? JSON.parse(responseText) as unknown : null;
    return { data: normalizeAnalysis(parsed, text, tone, sourceType), model: '@cf/meta/llama-3.1-8b-instruct-fast' };
  } catch (error) {
    console.warn('Workers AI failed. Using fallback parser.', error);
    return { data: fallbackAnalyze(text, tone, sourceType), model: 'fallback-parser' };
  }
}

async function getDashboard(env: Env): Promise<Response> {
  await reconcileDependencyStatuses(env);
  const [summaryResult, tasksResult, activitiesResult, latestAnalysis] = await Promise.all([
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND date(deadline) <= date('now', '+9 hours') THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND date(deadline) BETWEEN date('now', '+9 hours') AND date('now', '+9 hours', '+3 day') THEN 1 ELSE 0 END) AS urgent,
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
      FROM tasks
    `).first<{ today: number | null; urgent: number | null; waiting: number | null; total: number; done: number | null }>(),
    env.DB.prepare(`
      SELECT id, analysis_id, title, assignee, deadline, priority, confirmation, prerequisite, execution_order, category, status, created_at, updated_at
      FROM tasks
      ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
               CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
               deadline ASC,
               created_at DESC
      LIMIT 30
    `).all(),
    env.DB.prepare(`
      SELECT id, analysis_id, action, detail, created_at
      FROM activity_logs
      ORDER BY id DESC
      LIMIT 8
    `).all(),
    env.DB.prepare(`SELECT reply_draft FROM analyses ORDER BY created_at DESC, rowid DESC LIMIT 1`).first<{ reply_draft: string }>(),
  ]);

  const total = Number(summaryResult?.total ?? 0);
  const done = Number(summaryResult?.done ?? 0);

  return json({
    summary: {
      today: Number(summaryResult?.today ?? 0),
      urgent: Number(summaryResult?.urgent ?? 0),
      waiting: Number(summaryResult?.waiting ?? 0),
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    tasks: tasksResult.results,
    activities: activitiesResult.results,
    latestReplyDraft: latestAnalysis?.reply_draft ?? '',
  });
}

async function createAnalysis(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as { text?: unknown; sourceType?: unknown; tone?: unknown } | null;
  const text = cleanString(payload?.text);
  const sourceType = normalizeSourceType(payload?.sourceType);
  const tone = cleanString(payload?.tone, '丁寧').slice(0, 20);

  if (text.length < 8) return json({ error: '文章を8文字以上入力してください。' }, 400);
  if (text.length > 5000) return json({ error: '文章は5000文字以内にしてください。' }, 400);

  const analysisId = crypto.randomUUID();
  const { data, model } = await analyzeWithAI(env, text, sourceType, tone);
  const now = new Date().toISOString();

  // AI整理の段階ではD1へ保存しない。
  // 何度生成しても、フロント側の未保存結果が置き換わるだけにする。
  const draftTasks = applyDependencyStatuses(data.tasks).map((task) => ({
    id: `draft-${crypto.randomUUID()}`,
    analysis_id: analysisId,
    ...task,
    created_at: now,
    updated_at: now,
  }));

  return json({ analysisId, tasks: draftTasks, replyDraft: data.replyDraft, model });
}

async function saveAnalysis(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return json({ error: '保存内容が不正です。' }, 400);

  const sourceText = cleanString(payload.text);
  const sourceType = normalizeSourceType(payload.sourceType);
  const tone = cleanString(payload.tone, '丁寧').slice(0, 20);
  const replyDraft = cleanString(payload.replyDraft).slice(0, 3000);
  const model = cleanString(payload.model, 'unknown').slice(0, 120);
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks.slice(0, 50) : [];

  if (sourceText.length < 8) return json({ error: '保存元の文章が見つかりません。もう一度AI整理してください。' }, 400);
  if (sourceText.length > 5000) return json({ error: '文章は5000文字以内にしてください。' }, 400);
  if (rawTasks.length === 0) return json({ error: '保存するタスクがありません。' }, 400);

  const parsedEntries = rawTasks
    .map((raw, index): { task: ParsedTask & { status: TaskStatus }; requestedOrder: number } | null => {
      if (!raw || typeof raw !== 'object') return null;
      const task = raw as Record<string, unknown>;
      const title = cleanString(task.title).slice(0, 180);
      if (!title) return null;
      const numericOrder = Number(task.execution_order);
      return {
        task: {
          title,
          // ここはユーザーが保存前に手動編集した内容も尊重する。
          assignee: cleanString(task.assignee, '未設定').slice(0, 80) || '未設定',
          deadline: normalizeDate(task.deadline),
          priority: isPriority(task.priority) ? task.priority : 'medium',
          confirmation: normalizeReviewConfirmation(
            cleanString(task.confirmation).slice(0, 180),
            cleanString(task.assignee, '未設定').slice(0, 80) || '未設定',
            normalizeDate(task.deadline),
          ),
          prerequisite: cleanString(task.prerequisite).slice(0, 180),
          category: cleanString(task.category, '業務').slice(0, 80),
          status: isStatus(task.status) ? task.status : 'todo',
        },
        requestedOrder: Number.isFinite(numericOrder) && numericOrder > 0 ? Math.trunc(numericOrder) : index + 1,
      };
    })
    .filter((entry): entry is { task: ParsedTask & { status: TaskStatus }; requestedOrder: number } => entry !== null)
    .sort((a, b) => a.requestedOrder - b.requestedOrder);

  const parsedTasks = parsedEntries.map((entry) => entry.task);
  const normalizedTasks = applyDependencyStatuses(parsedTasks);
  if (normalizedTasks.length === 0) return json({ error: '保存できるタスクがありません。' }, 400);

  const maxOrderRow = await env.DB.prepare(`SELECT COALESCE(MAX(execution_order), 0) AS max_order FROM tasks`).first<{ max_order: number }>();
  const baseExecutionOrder = Number(maxOrderRow?.max_order ?? 0);
  const analysisId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO analyses (id, source_text, source_type, tone, reply_draft, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(analysisId, sourceText, sourceType, tone, replyDraft, model),
    env.DB.prepare(`INSERT INTO activity_logs (analysis_id, action, detail) VALUES (?, ?, ?)`)
      .bind(analysisId, 'AI整理結果を保存', `${normalizedTasks.length}件のタスクを確定`),
  ];

  const createdTasks = normalizedTasks.map((task, index) => {
    const id = crypto.randomUUID();
    statements.push(
      env.DB.prepare(`
        INSERT INTO tasks (id, analysis_id, title, assignee, deadline, priority, confirmation, prerequisite, execution_order, category, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, analysisId, task.title, task.assignee, task.deadline, task.priority, task.confirmation, task.prerequisite, baseExecutionOrder + index + 1, task.category, task.status),
    );
    return {
      id,
      analysis_id: analysisId,
      ...task,
      execution_order: baseExecutionOrder + index + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  statements.push(
    env.DB.prepare(`INSERT INTO activity_logs (analysis_id, action, detail) VALUES (?, ?, ?)`)
      .bind(analysisId, 'タスクをD1へ保存', `${createdTasks.length}件を保存`),
    env.DB.prepare(`INSERT INTO activity_logs (analysis_id, action, detail) VALUES (?, ?, ?)`)
      .bind(analysisId, '返信文を保存', `${tone}なトーンの下書きを保存`),
  );

  await env.DB.batch(statements);
  return json({ analysisId, tasks: createdTasks, replyDraft, model }, 201);
}

function taskOrder(sort: string): string {
  if (sort === 'execution') return "CASE WHEN execution_order IS NULL OR execution_order <= 0 THEN 1 ELSE 0 END, execution_order ASC, created_at ASC";
  if (sort === 'newest') return 'created_at DESC';
  if (sort === 'oldest') return 'created_at ASC';
  if (sort === 'priority') return "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, deadline ASC";
  return "CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END";
}

async function listTasks(request: Request, env: Env): Promise<Response> {
  await reconcileDependencyStatuses(env);
  const url = new URL(request.url);
  const q = cleanString(url.searchParams.get('q')).slice(0, 100);
  const status = cleanString(url.searchParams.get('status'));
  const priority = cleanString(url.searchParams.get('priority'));
  const sort = cleanString(url.searchParams.get('sort'), 'deadline');
  const reviewOnly = cleanString(url.searchParams.get('review')) === '1';
  const requestedLimit = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 100;

  const where: string[] = [];
  const values: unknown[] = [];
  if (q) {
    where.push('(title LIKE ? OR assignee LIKE ? OR category LIKE ? OR confirmation LIKE ? OR prerequisite LIKE ?)');
    const pattern = `%${q}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (isStatus(status)) {
    where.push('status = ?');
    values.push(status);
  }
  if (isPriority(priority)) {
    where.push('priority = ?');
    values.push(priority);
  }
  if (reviewOnly) {
    where.push("(assignee = '未設定' OR deadline IS NULL)");
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [tasksResult, countResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, analysis_id, title, assignee, deadline, priority, confirmation, prerequisite, execution_order, category, status, created_at, updated_at
      FROM tasks
      ${clause}
      ORDER BY ${taskOrder(sort)}
      LIMIT ?
    `).bind(...values, limit).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM tasks ${clause}`).bind(...values).first<{ total: number }>(),
  ]);

  return json({ tasks: tasksResult.results, total: Number(countResult?.total ?? 0) });
}

async function reorderTasks(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as { taskIds?: unknown } | null;
  if (!payload || !Array.isArray(payload.taskIds)) return json({ error: '並び順のデータが不正です。' }, 400);

  const taskIds = payload.taskIds
    .map((value) => cleanString(value))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 200);
  if (taskIds.length < 2) return json({ error: '並べ替えるタスクが不足しています。' }, 400);

  const placeholders = taskIds.map(() => '?').join(',');
  const rowsResult = await env.DB.prepare(`
    SELECT id, analysis_id, title, prerequisite
    FROM tasks
    WHERE id IN (${placeholders})
  `).bind(...taskIds).all<{ id: string; analysis_id: string | null; title: string; prerequisite: string }>();
  const rows = rowsResult.results;
  if (rows.length !== taskIds.length) return json({ error: '並べ替え対象のタスクが見つかりません。再読み込みしてください。' }, 409);

  const orderById = new Map(taskIds.map((id, index) => [id, index]));
  const taskByKey = new Map(rows.map((task) => [`${task.analysis_id ?? 'manual'}::${task.title}`, task]));
  for (const task of rows) {
    if (!task.prerequisite) continue;
    const parent = taskByKey.get(`${task.analysis_id ?? 'manual'}::${task.prerequisite}`);
    if (!parent) continue;
    const parentIndex = orderById.get(parent.id);
    const taskIndex = orderById.get(task.id);
    if (parentIndex !== undefined && taskIndex !== undefined && parentIndex >= taskIndex) {
      return json({ error: `「${task.title}」は、前提タスク「${task.prerequisite}」より後に配置してください。` }, 400);
    }
  }

  const statements: D1PreparedStatement[] = taskIds.map((id, index) =>
    env.DB.prepare(`UPDATE tasks SET execution_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(index + 1, id),
  );
  statements.push(
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`).bind('実行順を変更', `${taskIds.length}件をドラッグ＆ドロップで並べ替え`),
  );
  await env.DB.batch(statements);

  const reordered = await env.DB.prepare(`
    SELECT id, analysis_id, title, assignee, deadline, priority, confirmation, prerequisite, execution_order, category, status, created_at, updated_at
    FROM tasks
    WHERE id IN (${placeholders})
    ORDER BY execution_order ASC
  `).bind(...taskIds).all();
  return json({ tasks: reordered.results });
}

async function createTask(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = cleanString(payload?.title);
  if (!title) return json({ error: 'タスク名を入力してください。' }, 400);

  const id = crypto.randomUUID();
  const assignee = cleanString(payload?.assignee, '未設定').slice(0, 80) || '未設定';
  const deadline = normalizeDate(payload?.deadline);
  const priority = isPriority(payload?.priority) ? payload.priority : 'medium';
  const prerequisite = cleanString(payload?.prerequisite).slice(0, 180);
  const category = cleanString(payload?.category, '手動追加').slice(0, 80);
  const confirmation = normalizeReviewConfirmation(cleanString(payload?.confirmation).slice(0, 180), assignee, deadline);
  const parent = prerequisite
    ? await env.DB.prepare(`SELECT status FROM tasks WHERE title = ? ORDER BY created_at DESC LIMIT 1`).bind(prerequisite).first<{ status: TaskStatus }>()
    : null;
  const status: TaskStatus = parent && parent.status !== 'done' ? 'waiting' : 'todo';
  const maxOrderRow = await env.DB.prepare(`SELECT COALESCE(MAX(execution_order), 0) AS max_order FROM tasks`).first<{ max_order: number }>();
  const executionOrder = Number(maxOrderRow?.max_order ?? 0) + 1;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO tasks (id, title, assignee, deadline, priority, confirmation, prerequisite, execution_order, category, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, title.slice(0, 180), assignee, deadline, priority, confirmation, prerequisite, executionOrder, category, status),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`)
      .bind('タスクを手動追加', title.slice(0, 180)),
  ]);

  const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  return json(task, 201);
}

async function updateTask(request: Request, env: Env, id: string): Promise<Response> {
  const current = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!current) return json({ error: 'タスクが見つかりません。' }, 404);

  const patch = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!patch) return json({ error: '更新内容が不正です。' }, 400);

  const title = 'title' in patch ? cleanString(patch.title).slice(0, 180) : String(current.title);
  if (!title) return json({ error: 'タスク名は空にできません。' }, 400);

  const assignee = 'assignee' in patch ? (cleanString(patch.assignee, '未設定').slice(0, 80) || '未設定') : String(current.assignee);
  const deadline = 'deadline' in patch ? normalizeDate(patch.deadline) : (current.deadline as string | null);
  const priority = 'priority' in patch && isPriority(patch.priority) ? patch.priority : current.priority as Priority;
  const prerequisite = 'prerequisite' in patch ? cleanString(patch.prerequisite).slice(0, 180) : String(current.prerequisite ?? '');
  const category = 'category' in patch ? cleanString(patch.category, '業務').slice(0, 80) : String(current.category);
  const requestedStatus = 'status' in patch && isStatus(patch.status) ? patch.status : current.status as TaskStatus;
  const rawConfirmation = 'confirmation' in patch ? cleanString(patch.confirmation).slice(0, 180) : String(current.confirmation);
  const confirmation = normalizeReviewConfirmation(rawConfirmation, assignee || '未設定', deadline);

  const analysisId = current.analysis_id ? String(current.analysis_id) : null;
  const parent = prerequisite
    ? await env.DB.prepare(`
        SELECT status FROM tasks
        WHERE title = ? AND id <> ? AND (? IS NULL OR analysis_id = ?)
        ORDER BY created_at DESC LIMIT 1
      `).bind(prerequisite, id, analysisId, analysisId).first<{ status: TaskStatus }>()
    : null;
  const status: TaskStatus = parent && parent.status !== 'done' ? 'waiting' : requestedStatus;
  const oldTitle = String(current.title);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE tasks
      SET title = ?, assignee = ?, deadline = ?, priority = ?, confirmation = ?, prerequisite = ?, category = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(title, assignee || '未設定', deadline, priority, confirmation, prerequisite, category, status, id),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`) 
      .bind(status !== current.status ? 'タスク状態を更新' : 'タスクを編集', `${title}：${status}`),
  ];

  if (title !== oldTitle) {
    statements.push(
      env.DB.prepare(`UPDATE tasks SET prerequisite = ?, updated_at = CURRENT_TIMESTAMP WHERE prerequisite = ?`).bind(title, oldTitle),
    );
  }

  await env.DB.batch(statements);
  await reconcileDependencyStatuses(env);

  const updated = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  return json(updated);

}

async function deleteTask(env: Env, id: string): Promise<Response> {
  const current = await env.DB.prepare(`SELECT title FROM tasks WHERE id = ?`).bind(id).first<{ title: string }>();
  if (!current) return json({ error: 'タスクが見つかりません。' }, 404);
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET prerequisite = '', status = CASE WHEN status = 'waiting' THEN 'todo' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE prerequisite = ?`).bind(current.title),
    env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`).bind('タスクを削除', current.title),
  ]);
  return new Response(null, { status: 204 });
}

async function listTemplates(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT id, title, description, source_type, content, is_favorite, created_at, updated_at
    FROM templates
    ORDER BY is_favorite DESC, updated_at DESC
  `).all();
  return json(result.results);
}

async function createTemplate(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = cleanString(payload?.title).slice(0, 100);
  const content = cleanString(payload?.content).slice(0, 5000);
  if (!title || !content) return json({ error: 'テンプレート名と本文を入力してください。' }, 400);
  const id = crypto.randomUUID();
  const description = cleanString(payload?.description).slice(0, 240);
  const sourceType = normalizeSourceType(payload?.source_type);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO templates (id, title, description, source_type, content) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, title, description, sourceType, content),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`).bind('テンプレートを作成', title),
  ]);
  const template = await env.DB.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first();
  return json(template, 201);
}

async function updateTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const current = await env.DB.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!current) return json({ error: 'テンプレートが見つかりません。' }, 404);
  const patch = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!patch) return json({ error: '更新内容が不正です。' }, 400);

  const title = 'title' in patch ? cleanString(patch.title).slice(0, 100) : String(current.title);
  const description = 'description' in patch ? cleanString(patch.description).slice(0, 240) : String(current.description);
  const sourceType = 'source_type' in patch ? normalizeSourceType(patch.source_type) : String(current.source_type);
  const content = 'content' in patch ? cleanString(patch.content).slice(0, 5000) : String(current.content);
  const favorite = 'is_favorite' in patch ? (Number(patch.is_favorite) ? 1 : 0) : Number(current.is_favorite);
  if (!title || !content) return json({ error: 'テンプレート名と本文は空にできません。' }, 400);

  await env.DB.prepare(`
    UPDATE templates
    SET title = ?, description = ?, source_type = ?, content = ?, is_favorite = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(title, description, sourceType, content, favorite, id).run();
  const template = await env.DB.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first();
  return json(template);
}

async function deleteTemplate(env: Env, id: string): Promise<Response> {
  const current = await env.DB.prepare(`SELECT title FROM templates WHERE id = ?`).bind(id).first<{ title: string }>();
  if (!current) return json({ error: 'テンプレートが見つかりません。' }, 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM templates WHERE id = ?`).bind(id),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`).bind('テンプレートを削除', current.title),
  ]);
  return new Response(null, { status: 204 });
}

async function getHistory(env: Env): Promise<Response> {
  const [analyses, activities] = await Promise.all([
    env.DB.prepare(`
      SELECT a.id, a.source_text, a.source_type, a.tone, a.reply_draft, a.model, a.created_at,
             COUNT(t.id) AS task_count
      FROM analyses a
      LEFT JOIN tasks t ON t.analysis_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT 40
    `).all(),
    env.DB.prepare(`
      SELECT id, analysis_id, action, detail, created_at
      FROM activity_logs
      ORDER BY id DESC
      LIMIT 60
    `).all(),
  ]);
  return json({ analyses: analyses.results, activities: activities.results });
}

async function getSettings(env: Env): Promise<Response> {
  const settings = await env.DB.prepare(`
    SELECT display_name, workspace_name, default_tone, default_source_type
    FROM app_settings WHERE id = 1
  `).first();
  return json(settings ?? {
    display_name: '山田 花子',
    workspace_name: 'ワークスペースA',
    default_tone: '丁寧',
    default_source_type: 'email',
  });
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return json({ error: '設定内容が不正です。' }, 400);
  const displayName = cleanString(payload.display_name, '山田 花子').slice(0, 80);
  const workspaceName = cleanString(payload.workspace_name, 'ワークスペースA').slice(0, 80);
  const defaultTone = cleanString(payload.default_tone, '丁寧').slice(0, 20);
  const defaultSourceType = normalizeSourceType(payload.default_source_type);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO app_settings (id, display_name, workspace_name, default_tone, default_source_type, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        workspace_name = excluded.workspace_name,
        default_tone = excluded.default_tone,
        default_source_type = excluded.default_source_type,
        updated_at = CURRENT_TIMESTAMP
    `).bind(displayName, workspaceName, defaultTone, defaultSourceType),
    env.DB.prepare(`INSERT INTO activity_logs (action, detail) VALUES (?, ?)`).bind('設定を更新', `${displayName} / ${workspaceName}`),
  ]);
  return getSettings(env);
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'TaskPalette API' });
  if (url.pathname === '/api/dashboard' && request.method === 'GET') return getDashboard(env);
  if (url.pathname === '/api/analyze' && request.method === 'POST') return createAnalysis(request, env);
  if (url.pathname === '/api/analyze/save' && request.method === 'POST') return saveAnalysis(request, env);
  if (url.pathname === '/api/tasks' && request.method === 'GET') return listTasks(request, env);
  if (url.pathname === '/api/tasks' && request.method === 'POST') return createTask(request, env);
  if (url.pathname === '/api/tasks/reorder' && request.method === 'POST') return reorderTasks(request, env);
  if (url.pathname === '/api/templates' && request.method === 'GET') return listTemplates(env);
  if (url.pathname === '/api/templates' && request.method === 'POST') return createTemplate(request, env);
  if (url.pathname === '/api/history' && request.method === 'GET') return getHistory(env);
  if (url.pathname === '/api/settings' && request.method === 'GET') return getSettings(env);
  if (url.pathname === '/api/settings' && request.method === 'PUT') return updateSettings(request, env);

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && request.method === 'PATCH') return updateTask(request, env, decodeURIComponent(taskMatch[1]));
  if (taskMatch && request.method === 'DELETE') return deleteTask(env, decodeURIComponent(taskMatch[1]));

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch && request.method === 'PATCH') return updateTemplate(request, env, decodeURIComponent(templateMatch[1]));
  if (templateMatch && request.method === 'DELETE') return deleteTemplate(env, decodeURIComponent(templateMatch[1]));

  return json({ error: 'APIが見つかりません。' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'サーバー処理中にエラーが発生しました。' }, 500);
    }
  },
};
