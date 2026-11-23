import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilePicker } from './FilePicker.tsx';

const props = { label: 'Upload a file', hint: 'PDF, image or document, up to 20 MB.', accept: '.pdf,.png' };

describe('FilePicker', () => {
  it('is a real button described by the limits, opening a file input that filters by accept', async () => {
    const onSelect = vi.fn();
    const { container } = render(<FilePicker {...props} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: 'Upload a file' });
    expect(button).toHaveProperty('type', 'button');
    expect(screen.getByText(props.hint).id).toBe(button.getAttribute('aria-describedby'));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.pdf,.png');
    const file = new File(['%PDF'], 'eval-set-sample.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    expect(onSelect).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('announces progress and status, and ties an error to the button', () => {
    render(
      <FilePicker
        {...props}
        onSelect={() => undefined}
        progress={40}
        status="Uploading… 40%"
        error="We cannot use this file. Upload a PDF, image or document within the size limit."
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Uploading… 40%' })).toHaveProperty('value', 40);
    expect(screen.getByRole('status').textContent).toBe('Uploading… 40%');
    const error = screen.getByText('We cannot use this file. Upload a PDF, image or document within the size limit.');
    expect(error.className).toContain('text-err-text');
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toContain(error.id);
  });
});
