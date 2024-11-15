import { Component, Signal } from '@angular/core';
import { toSignal } from "@angular/core/rxjs-interop";
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { EncryptionService } from './core/encryption/encryption.service';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { NgClass } from '@angular/common';
import { Observable, combineLatest, debounceTime, switchMap } from 'rxjs';
import { EncryptionVerificationMarch } from './core/encryption/encryption.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass, ReactiveFormsModule, ClipboardModule, MatButtonModule, MatInputModule, MatSelectModule, MatFormFieldModule, MatMenuModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {

  encryptionTables = toSignal(this._encryptionService.encryptionTables$, { requireSync: true });
  selectedEncryptionTable = toSignal(this._encryptionService.selectedEncrytionTable$, { requireSync: true });

  encryptionForm = this._formBuilder.group({
    input: ['', Validators.required],
    output: ['']
  });

  encryptionStatus: Signal<{ input: EncryptionVerificationMarch; output: EncryptionVerificationMarch }> = toSignal(
    this.encryptionForm.valueChanges.pipe(
      debounceTime(300),
      switchMap(({ input, output }) => combineLatest({
        input: this._encryptionService.check(input ?? '', { includeUnencryptedWords: true }) as Observable<EncryptionVerificationMarch>,
        output: this._encryptionService.check(output ?? '', { includeUnencryptedWords: true }) as Observable<EncryptionVerificationMarch>
      }))
    ),
    { initialValue: { input: { result: true }, output: { result: true } } }
  );

  currentYear = new Date().getFullYear();

  /**
   * Constructor
   */
  constructor(
    private readonly _encryptionService: EncryptionService,
    private readonly _formBuilder: NonNullableFormBuilder
  ) { }

  // -------------------------------------------------------------------
  // @ Public methods
  // -------------------------------------------------------------------

  /**
   * Encrypt
   */
  encrypt(): void {

    // Does nothing if no input provided
    if (this.encryptionForm.invalid) return;

    const { input } = this.encryptionForm.getRawValue();

    this._encryptionService.encrypt(input).subscribe({
      next: output => this.encryptionForm.patchValue({ output })
    })
  }

  /**
   * Decrypt
   */
  decrypt(): void {

    // Does nothing if no input provided
    if (this.encryptionForm.invalid) return;

    const { input } = this.encryptionForm.getRawValue();

    this._encryptionService.decrypt(input).subscribe({
      next: output => this.encryptionForm.patchValue({ output })
    })
  }

  /**
   * Select encryption table change
   *
   * @param selectedEncryptionTable
   */
  onEncryptionTableChange(selectedEncryptionTable: string): void {
    this._encryptionService.select(selectedEncryptionTable).subscribe({
      next: () => this.encryptionForm.reset()
    });
  }
}

