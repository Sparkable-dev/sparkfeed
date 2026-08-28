import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db/index";
import { billingRequests } from "@/db/schema";

export const submitBillingRequest = createServerFn({ method: "POST" })
  .validator((data: { name: string; email: string; company: string; message: string }) => data)
  .handler(async ({ data }) => {
    try {
      await db.insert(billingRequests).values({
        id: randomUUID(),
        name: data.name,
        email: data.email,
        company: data.company,
        message: data.message,
      });

      return { success: true };
    } catch (err: any) {
      console.error("[ERROR] submitBillingRequest failed:", err);
      throw err;
    }
  });
