import { describe, expect, it } from 'vitest';
import {
  parsePage,
  detectPageType,
  mapPartOfSpeech,
  cleanHeading,
  extractPronunciation,
  cellToMarkdown,
  inlineMarkdown,
} from '@/lib/migration';
import { parse } from 'node-html-parser';

/**
 * Golden-file parser tests (Task 14).
 *
 * Representative fragments extracted from the real legacy pages
 * (htmls/index02-thesaurus, index03-words_by_genres, index04-words_look_around)
 * exercise the migration parser: table-type detection, inline → Markdown
 * conversion (<br>, <b>, numbered senses), empty-row skipping, pronunciation
 * extraction, and thesaurus → nested-category mapping.
 *
 * Parsing logic is imported directly from the lib (no shelling out).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

// ---------------------------------------------------------------------------
// Markdown conversion unit tests (pure)
// ---------------------------------------------------------------------------
describe('inline HTML → Markdown', () => {
  function md(html: string): string {
    const root = parse(`<div>${html}</div>`);
    return cellToMarkdown(root.querySelector('div')!);
  }

  it('converts <br> to newlines and trims/collapses whitespace', () => {
    expect(md('1. first <br> 2. second')).toBe('1. first\n2. second');
  });

  it('converts <b>/<strong> to **bold** and <i>/<em> to *italic*', () => {
    expect(md('to <b>stimulate</b> a <i>reaction</i>')).toBe(
      'to **stimulate** a *reaction*',
    );
    expect(md('<strong>x</strong> and <em>y</em>')).toBe('**x** and *y*');
  });

  it('drops empty lines produced by consecutive <br>', () => {
    expect(md('a <br><br> b')).toBe('a\nb');
  });

  it('decodes entities and normalizes non-breaking spaces', () => {
    expect(md('a&nbsp;&amp;&nbsp;b')).toBe('a & b');
  });

  it('ignores <img> when inlining a meaning cell', () => {
    expect(md('meaning <img src="img/x.jpg" alt="x">')).toBe('meaning');
  });
});

describe('extractPronunciation', () => {
  it('pulls a single leading /.../ token out of the meaning', () => {
    expect(extractPronunciation('/ˈspɪnɪtʃ/ 菠菜')).toEqual({
      pronunciation: '/ˈspɪnɪtʃ/',
      text: '菠菜',
    });
  });

  it('pulls multiple consecutive leading pronunciations', () => {
    expect(extractPronunciation('/ˈoʊbərʒiːn/ /ˈeɡplænt/ 茄子')).toEqual({
      pronunciation: '/ˈoʊbərʒiːn/ /ˈeɡplænt/',
      text: '茄子',
    });
  });

  it('returns null pronunciation when none is present', () => {
    expect(extractPronunciation('卷心菜；洋白菜')).toEqual({
      pronunciation: null,
      text: '卷心菜；洋白菜',
    });
  });

  it('does not treat a mid-text slash phrase as a pronunciation', () => {
    const result = extractPronunciation('to cause sth 激起；引起');
    expect(result.pronunciation).toBeNull();
  });
});

describe('cleanHeading + mapPartOfSpeech', () => {
  it('strips leading decorative glyphs from headings', () => {
    expect(cleanHeading('❷ 大学学生')).toBe('大学学生');
    expect(cleanHeading('\u2776 idioms')).toBe('idioms');
  });

  it('maps part-of-speech headings to codes', () => {
    expect(mapPartOfSpeech('V.')).toBe('V');
    expect(mapPartOfSpeech('N.')).toBe('N');
    expect(mapPartOfSpeech('ADJ.')).toBe('ADJ');
    expect(mapPartOfSpeech('Collection')).toBe('Collection');
    expect(mapPartOfSpeech('Vegetables')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Thesaurus golden file (index02 fragment)
// ---------------------------------------------------------------------------
const THESAURUS_HTML = `
<article><div id="content">
  <h1 id="A">V.</h1>
  <h2 id="1">刺激。激发。挑起</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th>MEANING</th><th>&nbsp;</th><th>MEANING</th></tr></thead>
    <tbody>
      <tr>
        <td>provoke</td>
        <td>1. to cause a particular reaction 激起；引起；引发<br />2. ~ sb to annoy sb 挑衅；激怒</td>
        <td>stimulate</td>
        <td>&nbsp;</td>
      </tr>
      <tr>
        <td>foment</td>
        <td>/fə(ʊ)'ment/<br />vt. 挑起，激起，煽动</td>
        <td></td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <h2 id="3">压制，压迫</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th>MEANING</th><th>&nbsp;</th><th>MEANING</th></tr></thead>
    <tbody>
      <tr>
        <td>subdue</td>
        <td>/səbˈduː/<br />vn. to bring sb under control 制服</td>
        <td>curb</td>
        <td>vn. to control or limit sth</td>
      </tr>
    </tbody>
  </table>
  <h1 id="B">N.</h1>
  <h2 id="a">屠杀，灾难</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th>MEANING</th></tr></thead>
    <tbody>
      <tr><td>massacre</td><td>/ˈmæsəkə/ 大屠杀</td></tr>
    </tbody>
  </table>
</div></article>`;

describe('thesaurus parser (index02)', () => {
  it('auto-detects the thesaurus page type', () => {
    const root = parse(THESAURUS_HTML);
    expect(detectPageType(root.querySelector('#content')!)).toBe('thesaurus');
  });

  it('maps h1 part-of-speech → h2 label → entries with extracted pronunciation', () => {
    const { document } = parsePage(THESAURUS_HTML, {
      categoryName: 'Thesaurus',
      pageType: 'thesaurus',
    });

    expect(document.categories).toHaveLength(1);
    const thesaurus = document.categories[0];
    expect(thesaurus.name).toBe('Thesaurus');
    expect(thesaurus.viewType).toBe('thesaurus');

    // Part-of-speech sub-categories.
    expect(thesaurus.children.map((c) => c.name)).toEqual(['V.', 'N.']);
    const verb = thesaurus.children[0];
    expect(verb.partOfSpeech).toBe('V');

    // Semantic-label sub-categories under V.
    expect(verb.children.map((c) => c.name)).toEqual(['刺激。激发。挑起', '压制，压迫']);

    const stimulate = verb.children[0];
    const provoke = stimulate.entries.find((e) => e.word === 'provoke')!;
    expect(provoke).toBeDefined();
    // Numbered senses preserved as Markdown across the <br>.
    expect(provoke.definitions[0].text).toBe(
      '1. to cause a particular reaction 激起；引起；引发\n2. ~ sb to annoy sb 挑衅；激怒',
    );

    // foment: pronunciation extracted from the leading /.../ token.
    const foment = stimulate.entries.find((e) => e.word === 'foment')!;
    expect(foment.pronunciation).toBe("/fə(ʊ)'ment/");
    expect(foment.definitions[0].text).toBe('vt. 挑起，激起，煽动');

    // "stimulate" has an empty meaning (&nbsp;) → no definition stored.
    const stim = stimulate.entries.find((e) => e.word === 'stimulate')!;
    expect(stim).toBeDefined();
    expect(stim.definitions).toEqual([]);
  });

  it('skips empty placeholder cell-pairs (no blank-word entries)', () => {
    const { document } = parsePage(THESAURUS_HTML, {
      categoryName: 'Thesaurus',
      pageType: 'thesaurus',
    });
    const verb = document.categories[0].children[0];
    const allWords = verb.children.flatMap((c) => c.entries.map((e) => e.word));
    // The empty 3rd/4th columns in the foment row must not create blank entries.
    expect(allWords.every((w) => w.trim().length > 0)).toBe(true);
    expect(allWords).toContain('provoke');
    expect(allWords).toContain('subdue');
    expect(allWords).toContain('curb');
  });
});

// ---------------------------------------------------------------------------
// Genre golden file (index03 fragment)
// ---------------------------------------------------------------------------
const GENRE_HTML = `
<article><div id="content">
  <h1 id="1">FOOD 1</h1>
  <h2>Vegetables</h2>
  <table>
    <thead><tr><th>&nbsp;</th><th>MEANING</th><th>img</th><th>&nbsp;</th><th>MEANING</th><th>img</th></tr></thead>
    <tbody>
      <tr class="with-IMG">
        <td>spinach</td>
        <td>/ˈspɪnɪtʃ/ 菠菜</td>
        <td class="td-IMG"><img src="img/spinach.jpg" alt=""></td>
        <td>cabbage</td>
        <td>卷心菜；洋白菜；甘蓝</td>
        <td class="td-IMG"><img src="img/cabbage.jpg"></td>
      </tr>
      <tr class="with-IMG">
        <td>clove</td>
        <td>/kləʊv/ 干丁香花苞</td>
        <td class="td-IMG"><img src="img/" alt=""></td>
        <td></td>
        <td></td>
        <td class="td-IMG"><img src="img/.jpg" alt=""></td>
      </tr>
    </tbody>
  </table>
</div></article>`;

describe('genre parser (index03)', () => {
  it('auto-detects the genre page type', () => {
    const root = parse(GENRE_HTML);
    expect(detectPageType(root.querySelector('#content')!)).toBe('genre');
  });

  it('maps genre → subsection → entries with image source references', () => {
    const { document } = parsePage(GENRE_HTML, {
      categoryName: 'Words by genres',
      pageType: 'genre',
    });

    const root = document.categories[0];
    expect(root.viewType).toBe('genre');
    const food = root.children[0];
    expect(food.name).toBe('FOOD 1');
    const vegetables = food.children[0];
    expect(vegetables.name).toBe('Vegetables');

    const spinach = vegetables.entries.find((e) => e.word === 'spinach')!;
    expect(spinach.pronunciation).toBe('/ˈspɪnɪtʃ/');
    expect(spinach.definitions[0].text).toBe('菠菜');
    expect(spinach.images).toHaveLength(1);
    expect(spinach.images[0].sourcePath).toBe('img/spinach.jpg');
    expect(spinach.images[0].filename).toBe('spinach.jpg');

    const cabbage = vegetables.entries.find((e) => e.word === 'cabbage')!;
    expect(cabbage.images[0].sourcePath).toBe('img/cabbage.jpg');

    // clove: placeholder image (img/) → no image attached.
    const clove = vegetables.entries.find((e) => e.word === 'clove')!;
    expect(clove.images).toEqual([]);
  });

  it('skips fully-empty placeholder triples', () => {
    const { document } = parsePage(GENRE_HTML, {
      categoryName: 'Words by genres',
      pageType: 'genre',
    });
    const vegetables = document.categories[0].children[0].children[0];
    expect(vegetables.entries.map((e) => e.word).sort()).toEqual(
      ['cabbage', 'clove', 'spinach'],
    );
  });
});

// ---------------------------------------------------------------------------
// Look-around golden file (index04 fragment)
// ---------------------------------------------------------------------------
const LOOK_AROUND_HTML = `
<article><div id="content">
  <h1 id="1">&#10112; 英语写作中符号的区别</h1>
  <ul>
    <li>hyphen "-"<div class="description">最短的符号，用来把两个词结合成一个词。</div></li>
    <li>en dash "–"<div class="description">表示 "之间" 的关系。</div></li>
  </ul>
  <p>例子：teacher–parent conference 指"教师和家长共同出席的会议"。</p>
  <h1 id="2">&#10113; 大学学生</h1>
  <h2>大一 ~ 大四</h2>
  <table>
    <thead><tr><th>Grades</th><th>Noun.</th></tr></thead>
    <tbody>
      <tr><td>大一</td><td>freshman</td></tr>
      <tr><td>大二</td><td>sophomore /ˈsɑːfəmɔːr/</td></tr>
    </tbody>
  </table>
</div></article>`;

describe('look-around parser (index04)', () => {
  it('auto-detects the look-around page type', () => {
    const root = parse(LOOK_AROUND_HTML);
    expect(detectPageType(root.querySelector('#content')!)).toBe('look-around');
  });

  it('handles mixed ul/table/p: list items, tables, and prose notes', () => {
    const { document } = parsePage(LOOK_AROUND_HTML, {
      categoryName: 'Look-around',
      pageType: 'look-around',
    });

    const root = document.categories[0];
    expect(root.viewType).toBe('list');
    // Two topics from the two <h1> sections.
    expect(root.children.map((c) => c.name)).toEqual([
      '英语写作中符号的区别',
      '大学学生',
    ]);

    // Topic 1: list items → entries; the <p> becomes a notes entry.
    const symbols = root.children[0];
    const hyphen = symbols.entries.find((e) => e.word === 'hyphen "-"')!;
    expect(hyphen).toBeDefined();
    expect(hyphen.definitions[0].text).toBe('最短的符号，用来把两个词结合成一个词。');

    const proseEntry = symbols.entries.find((e) => e.word === '英语写作中符号的区别')!;
    expect(proseEntry).toBeDefined();
    expect(proseEntry.notes).toContain('例子：teacher–parent conference');

    // Topic 2: table rows → entries, with pronunciation extracted.
    const students = root.children[1];
    const da1 = students.entries.find((e) => e.word === '大一')!;
    expect(da1.definitions[0].text).toBe('freshman');
    const da2 = students.entries.find((e) => e.word === '大二')!;
    // The h2 "大一 ~ 大四" is captured as prose context on the topic notes.
    expect(da2.definitions[0].text).toContain('sophomore');
  });
});
