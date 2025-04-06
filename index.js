require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const moment = require("moment");

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_ID;

// Подключение к MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
	.then(() => console.log("✅ MongoDB подключен"))
	.catch(err => console.log("❌ Ошибка подключения:", err));

// Модель пользователя
const User = mongoose.model("User", new mongoose.Schema({
	telegramId: String,
	name: String,
	age: Number,
}));

// Временное хранилище состояний
const userStates = {};
const pendingDeletes = {}; // Хранилище для ожидающих удалений

// Стартовая команда с защитой от ботов
bot.start(async (ctx) => {
	const userId = ctx.from.id;

	// Проверка на бота
	if (ctx.from.is_bot) {
		return ctx.reply("⛔️ Боты не допускаются.");
	}

	// Отправляем сообщение с кнопками для подтверждения, что пользователь не бот
	await ctx.reply(
		"👋 Добро пожаловать! Мы рады видеть вас на регистрации. Пожалуйста, подтвердите, что вы не бот.",
		Markup.inlineKeyboard([
			[Markup.button.callback("✅ Я не бот", "confirm_not_bot")],
		])
	);
});

// Обработка кнопок
bot.on("callback_query", async (ctx) => {
	const userId = ctx.from.id;
	const data = ctx.callbackQuery.data;

	// Проверка на нажатие кнопки "Я не бот"
	if (data === "confirm_not_bot") {
		// Отправляем сообщение с двумя кнопками: продолжение регистрации или правила
		await ctx.editMessageText(
			"😊 Мы рады видеть вас на регистрации! Выберите, что хотите сделать:",
			Markup.inlineKeyboard([
				[Markup.button.callback("✅ Продолжить регистрацию", "start_registration")],
				[Markup.button.callback("📜 Правила соревнований", "show_rules")]
			])
		);
		return;
	}

	// Отображение правил
	if (data === "show_rules") {
		await ctx.answerCbQuery();

		const sentMessage = await ctx.reply(
			"📜 Правила соревнований:\n" +
			"1. Уважайте других участников.\n" +
			"2. Соблюдайте указания организаторов.\n" +
			"3. Запрещены читерство и агрессия.\n" +
			"4. Участвуйте честно и получайте удовольствие!"
		);

		// Сохраняем message_id
		userStates[userId] = {
			...(userStates[userId] || {}),
			rulesMessageId: sentMessage.message_id,
		};
		return;
	}

	// Продолжение регистрации

	if (data === "start_registration") {
		// Удаляем сообщение с правилами, если есть
		if (userStates[userId]?.rulesMessageId) {
			try {
				await ctx.deleteMessage(userStates[userId].rulesMessageId);
			} catch (e) {
				console.log("Не удалось удалить сообщение с правилами:", e.message);
			}
		}

		userStates[userId] = { step: "name" };
		await ctx.editMessageText("Как вас зовут?");
		ctx.answerCbQuery();
		return;
	}

	// Обработка удаления пользователя
	if (data.startsWith("confirm_")) {
		const userIdToDelete = data.split("confirm_")[1]; // Получаем _id пользователя для удаления
		const user = await User.findById(userIdToDelete); // Ищем пользователя по _id

		if (!user) {
			ctx.answerCbQuery("❌ Пользователь не найден.");
			return;
		}

		pendingDeletes[userId] = { userIdToDelete, name: user.name };

		await ctx.editMessageText(
			`❗️ Вы уверены, что хотите удалить пользователя:\n👤 ${user.name} (${user.telegramId})?`,
			Markup.inlineKeyboard([
				Markup.button.callback("✅ Да, удалить", `delete_confirmed_${userIdToDelete}`),
				Markup.button.callback("↩️ Отмена", "cancel")
			])
		);

		ctx.answerCbQuery();
		return;
	}

	// Удаление пользователя
	if (data.startsWith("delete_confirmed_")) {
		const userIdToDelete = data.split("delete_confirmed_")[1];
		const user = await User.findById(userIdToDelete); // Ищем пользователя по _id

		if (!user) {
			ctx.answerCbQuery("❌ Пользователь не найден.");
			return;
		}

		const result = await User.deleteOne({ _id: userIdToDelete });
		if (result.deletedCount === 0) {
			await ctx.editMessageText("❌ Пользователь не найден или уже удалён.");
		} else {
			await ctx.editMessageText(`✅ Пользователь ${user.name} удалён.`);

			const time = moment().format("YYYY-MM-DD HH:mm");
			const adminUsername = ctx.from.username || `ID ${ctx.from.id}`;
			await bot.telegram.sendMessage(ADMIN_ID,
				`🗑 Пользователь удалён:\n` +
				`👤 Имя: ${user.name}\n` +
				`🆔 Telegram ID: ${user.telegramId}\n` +
				`👮 Удалил: @${adminUsername}\n` +
				`🕒 Время: ${time}`
			);
		}

		ctx.answerCbQuery();
		return;
	}

	// Отмена удаления
	if (data === "cancel") {
		await ctx.editMessageText("❎ Удаление отменено.");
		ctx.answerCbQuery("❎ Отменено");
		return;
	}
});

// Обработка текстовых сообщений
bot.on("text", async (ctx) => {
	const userId = ctx.from.id;
	const message = ctx.message.text.trim();

	// Команда /list — только для админа
	if (message === "/list") {
		if (userId.toString() !== ADMIN_ID) {
			ctx.reply("⛔️ У вас нет доступа.");
			return;
		}

		const users = await User.find();
		if (users.length === 0) {
			ctx.reply("👤 Список пользователей пуст.");
			return;
		}

		for (const user of users) {
			await ctx.reply(
				`🆔 ${user.telegramId}\n👤 ${user.name}, ${user.age} лет`,
				Markup.inlineKeyboard([
					Markup.button.callback("❌ Удалить", `confirm_${user._id}`) // Используем _id вместо telegramId
				])
			);
		}
		return;
	}

	// Проверка: прошёл ли проверку "Я не бот"
	if (!userStates[userId] || !userStates[userId].step) {
		ctx.reply("Пожалуйста, нажмите /start и подтвердите, что вы не бот.");
		return;
	}

	// Шаг 1: имя
	if (userStates[userId].step === "name") {
		userStates[userId].name = message;
		userStates[userId].step = "age";
		ctx.reply("Сколько вам лет?");
	}

	// Шаг 2: возраст
	else if (userStates[userId].step === "age") {
		const age = parseInt(message);
		if (isNaN(age) || age <= 0 || age >= 100) {
			ctx.reply("Введите корректный возраст (от 1 до 99).");
			return;
		}

		userStates[userId].age = age;

		await User.create({
			telegramId: userId,
			name: userStates[userId].name,
			age: userStates[userId].age,
		});

		ctx.reply(`Спасибо! Ваше имя: ${userStates[userId].name}, вам: ${userStates[userId].age} лет. Good Luck!!!`);
		delete userStates[userId];
	}
});

// Запуск в режиме polling или webhook в зависимости от окружения
if (process.env.RENDER_DOMAIN) {
	// Продакшн: запуск через webhook
	const WEBHOOK_URL = `https://${process.env.RENDER_DOMAIN}/telegram-bot`;

	bot.telegram.setWebhook(WEBHOOK_URL);
	app.use(bot.webhookCallback("/telegram-bot"));

	const PORT = process.env.PORT || 3000;
	app.listen(PORT, () => {
		console.log(`🚀 Сервер запущен на порту ${PORT}`);
		console.log(`🤖 Бот работает через Webhook: ${WEBHOOK_URL}`);
	});
} else {
	// Локальная разработка: polling
	bot.telegram.deleteWebhook();
	bot.launch();
	console.log("🤖 Бот запущен локально через polling");
}