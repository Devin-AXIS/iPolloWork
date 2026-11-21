import { createElement, forwardRef } from 'react';

export const Input = forwardRef(function Input({ icon, className, ...props }, ref) {
  return createElement('span', { className }, icon, createElement('input', { ...props, ref }));
});

export const Button = forwardRef(function Button({ icon, variant, size, children, type = 'button', ...props }, ref) {
  return createElement('button', { ...props, type, ref }, icon, children);
});
