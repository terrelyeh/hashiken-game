import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

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

async function run() {
    let output = 'export const voiceData: Record<string, string> = {\n';
    for (const p of phrases) {
        console.log('Fetching', p.key);
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
                output += `  "${p.key}": "${base64}",\n`;
            } else {
                console.error('Failed for', p.key);
            }
        } catch (e) {
            console.error('Error for', p.key, e);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    output += '};\n';
    fs.writeFileSync('src/voiceData.ts', output);
    console.log('Done!');
}
run();
