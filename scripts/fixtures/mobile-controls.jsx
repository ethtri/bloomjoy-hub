// Local synthetic primitive fixture. No auth, customer data or API clients.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

document.body.classList.add('app-surface');

function Confirmation({ kind }) {
  const isLong = kind === 'Long';
  const explicitFocus = kind === 'Explicit'
    ? event => {
      event.preventDefault();
      document.getElementById('explicit-note')?.focus();
    }
    : undefined;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button>{kind} confirmation</Button></AlertDialogTrigger>
      <AlertDialogContent onOpenAutoFocus={explicitFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Review synthetic request</AlertDialogTitle>
          <AlertDialogDescription>Local confirmation with no payment or customer action.</AlertDialogDescription>
        </AlertDialogHeader>
        {isLong && (
          <details open>
            <summary>Preview customer email</summary>
            <div className="space-y-3 pt-3">
              {Array.from({ length: 12 }, (_, index) => (
                <p key={index}>Synthetic paragraph {index + 1}: Review the selected purchase and machine details. This is a local interface demonstration with an expanded email.</p>
              ))}
            </div>
          </details>
        )}
        {(isLong || kind === 'Explicit') && (
          <label>Confirmation note
            <Textarea id={kind === 'Explicit' ? 'explicit-note' : undefined} aria-label="Confirmation note" defaultValue="Local QA only" />
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm synthetic request</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

createRoot(document.getElementById('root')).render(
  <main className="space-y-4 p-4">
    <h1 className="text-2xl">Synthetic mobile confirmation</h1>
    <Confirmation kind="Long" />
    <Confirmation kind="Short" />
    <Confirmation kind="Explicit" />
  </main>,
);
