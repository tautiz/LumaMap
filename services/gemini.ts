import { GoogleGenAI } from "@google/genai";

const getGeminiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API Key not found in environment variables");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export async function generateTexture(prompt: string): Promise<string> {
    const ai = getGeminiClient();

    const finalPrompt = `Seamless texture pattern, flat top-down view, high contrast, suitable for projection mapping: ${prompt}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: finalPrompt }]
            },
            config: {
                // Generate 1 image
            }
        });

        // Parse response for image
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
        
        throw new Error("No image data found in response");
    } catch (error) {
        console.error("Gemini Generation Error:", error);
        throw error;
    }
}
