import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
export default async function LoginPage() { if(await getCurrentUser()) redirect("/"); return <LoginForm/>; }
