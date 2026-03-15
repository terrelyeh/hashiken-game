import fs from 'fs';
import path from 'path';
import https from 'https';

const phrases = [
  { key: 'irasshai', text: 'いらっしゃい' },
  { key: 'sanbon', text: 'さんぼん' },
  { key: 'ippon', text: 'いっぽん' },
  { key: 'gohon', text: 'ごほん' },
  { key: 'win', text: '俺の勝ちだ' },
  { key: 'lose', text: '負けた' },
  { key: 'round_win', text: '勝負あり' },
  { key: 'round_lose', text: 'やられた' },
  { key: 'round_draw', text: 'もう一回' }
];

async function downloadTTS(text: string, filepath: string) {
  return new Promise<void>((resolve, reject) => {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ja&client=tw-ob`;
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => reject(err));
    });
  });
}

async function generateAll() {
  const dir = path.join(process.cwd(), 'public', 'voices');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const p of phrases) {
    console.log(`Generating ${p.key}...`);
    try {
      await downloadTTS(p.text, path.join(dir, `${p.key}.mp3`));
      console.log(`Saved ${p.key}.mp3`);
    } catch (e) {
      console.error(`Failed to generate ${p.key}:`, e);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

generateAll();
