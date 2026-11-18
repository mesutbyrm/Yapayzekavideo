import { LoginForm } from "./login-form";
export const metadata = { title: "Giriş" };
export default function LoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <LoginForm />
    </div>
  );
}
