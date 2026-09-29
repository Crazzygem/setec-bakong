import { ButtonLink, Wordmark } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <Wordmark />
      <h1 className="mt-10 text-[28px] font-bold">We could not find that</h1>
      <p className="mt-2 text-body">
        Check the room code on your door, or scan the QR code in the room again.
      </p>
      <ButtonLink href="/" className="mt-8 self-start">
        Enter a room code
      </ButtonLink>
    </div>
  );
}
