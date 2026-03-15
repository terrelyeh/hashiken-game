import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

async function generateAll() {
  const dir = path.join(process.cwd(), 'public', 'voices');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const p of phrases) {
    console.log(`Generating ${p.key}...`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say very loudly, forcefully, and energetically in Japanese: ${p.text}!` }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } }
        }
      });
      const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64) {
        const pcmBuffer = Buffer.from(base64, 'base64');
        
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcmBuffer.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(24000, 24);
        header.writeUInt32LE(48000, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(pcmBuffer.length, 40);

        const finalBuffer = Buffer.concat([header, pcmBuffer]);
        fs.writeFileSync(path.join(dir, `${p.key}.wav`), finalBuffer);
        console.log(`Saved ${p.key}.wav`);
      }
    } catch (e) {
      console.error(`Failed to generate ${p.key}:`, e);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

generateAll();
