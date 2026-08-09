'use client';

import { authClient } from '@/lib/auth/client';
import { useGetBackground } from '@/hooks/use-get-background';
import { transKeys } from '@/i18n/keys';
import { LocalForageKeys, Routes } from '@/utils/constants';
import { SignInMethod } from '@onlook/models/auth';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import localforage from 'localforage';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { DevLoginButton, LoginButton } from '../_components/login-button';

export function LoginClient({
    githubEnabled,
    googleEnabled,
    devLoginEnabled,
}: {
    githubEnabled: boolean;
    googleEnabled: boolean;
    devLoginEnabled: boolean;
}) {
    const t = useTranslations();
    const backgroundUrl = useGetBackground('login');
    const returnUrl = useSearchParams().get(LocalForageKeys.RETURN_URL);
    const [isSignUp, setIsSignUp] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            if (returnUrl) {
                await localforage.setItem(LocalForageKeys.RETURN_URL, returnUrl);
            }
            const result = isSignUp
                ? await authClient.signUp.email({
                    name: name.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    callbackURL: Routes.AUTH_REDIRECT,
                })
                : await authClient.signIn.email({
                    email: email.trim().toLowerCase(),
                    password,
                    callbackURL: Routes.AUTH_REDIRECT,
                });
            if (result.error) {
                throw new Error(result.error.message ?? 'Authentication failed');
            }
            window.location.assign(Routes.AUTH_REDIRECT);
        } catch (error) {
            toast.error(isSignUp ? 'Could not create account' : 'Could not sign in', {
                description: error instanceof Error ? error.message : 'Please try again.',
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen w-screen justify-center">
            <div className="flex flex-col justify-between w-full h-full max-w-xl p-16 space-y-8 overflow-auto">
                <div className="flex items-center space-x-2">
                    <Link href={Routes.HOME} className="hover:opacity-80 transition-opacity">
                        <Icons.OnlookTextLogo viewBox="0 0 139 17" />
                    </Link>
                </div>
                <div className="space-y-8">
                    <div className="space-y-4">
                        <h1 className="text-title1 leading-tight">{t(transKeys.welcome.title)}</h1>
                        <p className="text-foreground-onlook text-regular">{t(transKeys.welcome.description)}</p>
                    </div>

                    {(githubEnabled || googleEnabled) && (
                        <div className="space-y-2 md:space-y-0 md:space-x-2 flex flex-col md:flex-row">
                            {githubEnabled && (
                                <LoginButton
                                    returnUrl={returnUrl}
                                    method={SignInMethod.GITHUB}
                                    icon={<Icons.GitHubLogo className="w-4 h-4 mr-2" />}
                                    translationKey="github"
                                    providerName="GitHub"
                                />
                            )}
                            {googleEnabled && (
                                <LoginButton
                                    returnUrl={returnUrl}
                                    method={SignInMethod.GOOGLE}
                                    icon={<Icons.GoogleLogo viewBox="0 0 24 24" className="w-4 h-4 mr-2" />}
                                    translationKey="google"
                                    providerName="Google"
                                />
                            )}
                        </div>
                    )}

                    <form className="space-y-3" onSubmit={submitCredentials}>
                        {isSignUp && (
                            <Input
                                type="text"
                                autoComplete="name"
                                placeholder="Name"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                required
                            />
                        )}
                        <Input
                            type="email"
                            autoComplete="email"
                            placeholder="Email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                        />
                        <Input
                            type="password"
                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                            placeholder="Password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            minLength={8}
                            required
                        />
                        <Button type="submit" className="w-full" disabled={submitting}>
                            {submitting && <Icons.LoadingSpinner className="w-4 h-4 mr-2 animate-spin" />}
                            {isSignUp ? 'Create account' : 'Sign in with email'}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            className="w-full"
                            onClick={() => setIsSignUp((value) => !value)}
                            disabled={submitting}
                        >
                            {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
                        </Button>
                    </form>

                    {devLoginEnabled && <DevLoginButton returnUrl={returnUrl} />}
                    <p className="text-small text-foreground-onlook">
                        {t(transKeys.welcome.terms.agreement)}{' '}
                        <Link href="https://onlook.com/privacy-policy" target="_blank" className="text-gray-300 hover:text-gray-50 underline transition-colors duration-200">
                            {t(transKeys.welcome.terms.privacy)}
                        </Link>{' '}
                        {t(transKeys.welcome.terms.and)}{' '}
                        <Link href="https://onlook.com/terms-of-service" target="_blank" className="text-gray-300 hover:text-gray-50 underline transition-colors duration-200">
                            {t(transKeys.welcome.terms.tos)}
                        </Link>
                    </p>
                </div>
                <div className="flex flex-row space-x-1 text-small text-gray-600">
                    <p>{t(transKeys.welcome.version, { version: '1.0.0' })}</p>
                </div>
            </div>
            <div className="hidden w-full md:block m-6">
                <Image className="w-full h-full object-cover rounded-xl" src={backgroundUrl} alt="Onlook dunes dark" width={1000} height={1000} />
            </div>
        </div>
    );
}
