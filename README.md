# slack-mfa-bot

This bot allows you to share MFA one-time tokens with your team members.

They request a token, your admins approve it. And all that on Slack.

## Syntax

1. help
2. request mfa [service] for [reason]
3. grant [@user] mfa [service] for [minutes] minutes
4. decline [@user] mfa [service]
5. add mfa [service] with key [key]
6. remove mfa [service]
7. list mfas
8. add admin [@user] with priority [priority]
9. remove admin [@user]
10. list admins

## Flow

@member <-> @mfa-bot
> @member: request mfa acme for testing something new

@admin <-> @mfa-bot
> @mfa-bot: User @member is asking permission to access acme in order to 'testing something new' - grant or decline?

> @admin: grant @member mfa acme for 5 minutes

> @mfa-bot: You granted @member access to acme for 5 minutes.

@member <-> @mfa-bot
> @mfa-bot: Your token for acme is: 123456


## Requirements

MongoDB

## Install

Run `npm install`

## Run

Run `node server.js --token SLACK_BOT_TOKEN --crypt RANDOM_STRING --mongo MONGO_DB_URL`
