import { randomUUID } from "crypto";
import { Langfuse } from "langfuse";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { LangfuseExporter } from "langfuse-vercel";

const sdk = new NodeSDK({
traceExporter: new LangfuseExporter(),
instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

const langfuse = new Langfuse();
const parentTraceId = randomUUID();
 
langfuse.trace({
  id: parentTraceId,
  name: "holiday-traditions",
});
 
for (let i = 0; i < 3; i++) {
  const result = await generateText({
    model: openai("gpt-3.5-turbo"),
    maxTokens: 50,
    prompt: "Invent a new holiday and describe its traditions.",
    experimental_telemetry: {
      isEnabled: true,
      functionId: `holiday-tradition-${i}`,
      metadata: {
        langfuseTraceId: parentTraceId,
        langfuseUpdateParent: false, // Do not update the parent trace with execution results
      },
    },
  });
 
  console.log(result.text);
}
 
await langfuse.flushAsync();
await sdk.shutdown();