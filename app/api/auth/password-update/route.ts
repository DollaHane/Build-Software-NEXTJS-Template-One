import { headers } from "next/headers"
import { db } from "@/server/db"
import { users } from "@/server/db/schema"
import { redis } from "@/server/upstash"
import { Ratelimit } from "@upstash/ratelimit"
import bcrypt from "bcrypt"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { userType } from "@/types/db"
import { getAuthSession } from "@/lib/auth/auth-options"
import { validateUpdatePassword } from "@/lib/validators/authValidation"

const rateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "30 s"),
  analytics: true,
})

export async function POST(req: Request) {
  try {
    const ip = (await headers()).get("x-forwarded-for")
    const {
      remaining,
      limit,
      success: limitReached,
    } = await rateLimit.limit(ip!)
    console.log("Rate Limit Stats:", remaining, limit, limitReached)

    const session = await getAuthSession()

    if (!session?.user) {
      return new Response("Unauthorised", { status: 401 })
    }

    const body = await req.json()
    const { email, newPassword, previousPassword } =
      validateUpdatePassword.parse(body)

    if (!limitReached) {
      return new Response("API request limit reached", { status: 429 })
    } else {
      const user: userType[] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
      

      if (
        user[0].password === "changeme" ||
        bcrypt.compareSync(previousPassword, user[0].password!)
      ) {
        const hashedPassword = await bcrypt.hash(newPassword, 10)
        const post = await db
          .update(users)
          .set({
            password: hashedPassword,
          })
          .where(eq(users.email, email))

        return new Response(JSON.stringify(post), { status: 200 })
      } else {
        return new Response("Supplied password was incorrect.", { status: 402 })
      }
    }
  } catch (error) {
    console.error("Could not change password at this time. ERROR:", error)
    if (error instanceof z.ZodError) {
      return new Response(`Zod validation error: ${error.message}`, { status: 400 })
    }
    return new Response(
      "Could not change password at this time. Please try again later",
      { status: 500 }
    )
  }
}